"""One app: established download engine plus the enhanced local cinema."""
import logging
import os
from pathlib import Path
import signal
import threading

from waitress import create_server
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.wrappers import Response

from fastshare_app.app import create_app as create_downloader
from fastshare_app.local_web import lan_application
from .app import create_app as create_player, player_application
from .settings import Settings


class SharedSettings(Settings):
    """One source for language, folders and network settings in both interfaces."""
    def __init__(self, directory, core, local):
        super().__init__(directory)
        self.core, self.local = core, local

    def get(self):
        value = super().get()
        core = self.core.get()
        value.update(language=core['language'],
                     media_roots=list(dict.fromkeys([core['download_dir']] + core['media_dirs'])),
                     lan_enabled=core['viewer_enabled'], lan_port=core['viewer_port'],
                     lan_host=core['viewer_host'])
        return value

    def configure_shared(self, patch):
        proposed = self.save(patch, dry_run=True)
        core_patch = {'language': proposed['language'],
                      'media_dirs': [p for p in proposed['media_roots'] if p != self.core.get()['download_dir']]}
        network = {'viewer_enabled': proposed['lan_enabled'], 'viewer_port': proposed['lan_port'],
                   'viewer_host': proposed['lan_host']}
        self.core.save({**core_patch, **network}, internal=True, dry_run=True)
        result = self.local.configure(network)
        self.core.save(core_patch)
        self.save(patch)
        return {**result, 'settings': self.public()}


def create_service(directory=None, start=True):
    directory = Path(directory or os.environ.get('PLAY_DATA', '.runtime')).resolve()
    previous = Settings(directory).get()
    fresh = not (directory / 'downloader' / 'settings.json').exists()
    core = create_downloader(directory / 'downloader', start=False)
    config = core.extensions['settings']
    if fresh:
        patch = {'language': previous['language'], 'mqtt_enabled': False, 'paused': True,
                 'viewer_enabled': previous['lan_enabled'], 'viewer_port': previous['lan_port'],
                 'viewer_host': previous['lan_host']}
        if previous['media_roots']:
            patch.update(download_dir=previous['media_roots'][0], media_dirs=previous['media_roots'][1:])
        config.save(patch, internal=True)
    settings = SharedSettings(directory, config, core.extensions['local_web'])
    player = create_player(start=start, settings=settings, local=core.extensions['local_web'])
    dispatch = DispatcherMiddleware(core, {'/cinema': player})

    def application(environ, start_response):
        if environ.get('PATH_INFO') == '/cinema':
            return Response(status=302, headers={'Location': 'cinema/'})(environ, start_response)
        return dispatch(environ, start_response)

    if start:
        core.extensions['engine'].start()
        core.extensions['publisher'].start()

        def register_card():
            if not os.environ.get('SUPERVISOR_TOKEN'): return
            for _ in range(6):
                try:
                    core.extensions['homeassistant'].install_resource()
                    return
                except Exception:
                    core.extensions['homeassistant'].error = 'Dashboard registration will retry.'
                if core.extensions['engine'].stop.wait(30): return
        threading.Thread(target=register_card, daemon=True).start()
    return application, core, player


def main():
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    application, core, player = create_service()
    cfg = core.extensions['settings'].get()
    limits = {'threads': 12, 'connection_limit': 100, 'channel_timeout': 60,
              'outbuf_overflow': 1024 * 1024}
    servers = [create_server(application, host='0.0.0.0', port=int(os.environ.get('PORT', 8099)), map={}, **limits)]
    if os.environ.get('SUPERVISOR_TOKEN') or cfg['viewer_enabled']:
        servers.append(create_server(player_application(player), host='0.0.0.0',
                                     port=8098 if os.environ.get('SUPERVISOR_TOKEN') else cfg['viewer_port'], map={}, **limits))
    if os.environ.get('SUPERVISOR_TOKEN') or cfg['lan_enabled']:
        servers.append(create_server(lan_application(application), host='0.0.0.0',
                                     port=8096 if os.environ.get('SUPERVISOR_TOKEN') else cfg['lan_port'], map={}, **limits))

    def close(*args):
        core.extensions['engine'].close()
        core.extensions['publisher'].close()
        player.extensions['catalog'].close()
        for server in servers: server.close()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, close)
    signal.signal(signal.SIGINT, close)
    for server in servers[1:]: threading.Thread(target=server.run, daemon=True).start()
    servers[0].run()


if __name__ == '__main__': main()
