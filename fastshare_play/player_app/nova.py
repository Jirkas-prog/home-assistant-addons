# Copyright 2017 Archos SA
# Copyright 2026 Jirkas-prog
# Licensed under the Apache License, Version 2.0. See LICENSE.
# MODIFIED: selected NOVA/Archos Java parsing logic ported to Python, 2026-10-28.
# Sources and pinned revisions are documented in NOTICE and docs/UPSTREAM.md.
"""Filename, NFO and resume compatibility with NOVA Video Player.

Adapted from ParseUtils, MovieDefaultMatcher, NfoMovieHandler, NfoEpisodeHandler,
NfoWriter and XmlDb. Android providers, UI and decoders are not included.
"""
from datetime import datetime
from pathlib import Path
import math
import re
import unicodedata
from urllib.parse import unquote
from xml.etree import ElementTree as ET

VIDEO_TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
               '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
               '.ts': 'video/mp2t', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.ogv': 'video/ogg'}
IMAGE_TYPES = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
JUNK = ('dvdrip', 'dvd rip', 'dvdscreener', 'dvdscr', 'brrip', 'br rip', 'bdrip',
        'blu ray', 'bluray', 'hddvd', 'hdrip', 'hd rip', 'hdlight', 'webrip', 'web rip',
        '720p', '1080p', '1080i', '2160p', '4k', '480p', '576p', '4320p', '8k',
        'hdtv', 'sdtv', 'h264', 'x264', 'h265', 'x265', 'aac', 'ac3', 'dts', 'hevc', 'av1',
        'xvid', 'divx', 'directors cut', 'readnfo', 'repack', 'remastered', 'extended cut',
        'sbs', 'hsbs', 'side by side', '3d', 'truehd', 'atmos', 'uhd', 'hdr', 'dolby')


def number(value, default=0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (ValueError, TypeError):
        return default


def clean_title(name):
    """NOVA's fallback: year, numbering, brackets, separators, release suffixes."""
    original = name
    year = 0
    matches = list(re.finditer(r'[\s\W]((?:19|20)\d{2})(?!\d)', name))
    for match in reversed(matches):
        if 1900 <= int(match[1]) <= datetime.now().year + 1 and len(name[:match.start()].strip()) >= 2:
            year = int(match[1]); name = name[:match.start()]; break
    name = re.sub(r'^(\d+(?:[.)][\s\W]+|\s+\W[\W\s]*))+', '', name)
    name = re.sub(r'[<({\[].*?[>)}\]]', '', name)
    name = re.split(r'[ ._-](?:FRENCH|TRUEFRENCH|DUAL|MULTISUBS|MULTI|REMUX|IMAX|WEB|EN|ENG|HD)(?:[ ._-]|$)', name)[0]
    name = name.replace('’', "'").replace('‘', "'")
    name = re.sub(r'(?<=[A-Z])\.(?=[A-Z](?:\.|$))', '', name)
    name = ''.join(' ' if (unicodedata.category(c).startswith('P') and c != "'") else c for c in name)
    name = re.sub(r'\s+', ' ', name).strip()
    lower = ' ' + name.lower() + ' '
    cuts = [lower.find(' ' + token + ' ') for token in JUNK]
    cuts = [offset for offset in cuts if offset >= 0]
    if cuts: name = name[:min(cuts)].strip()
    # Czech/Slovak release suffixes, added for this web adaptation.
    name = re.sub(r'\s+(?:cz|cze|sk|dabing|dab|cz dab|cz en|en cz)(?:\s.*)?$', '', name, flags=re.I).strip()
    return name or original, year


def filename_metadata(path):
    stem = path.stem
    episode = re.search(r'(?i)(?:\b|[._ -])s(\d{1,2})[ ._-]*e(\d{1,3})(?:\b|[._ -])', stem)
    if not episode:
        episode = re.search(r'(?i)(?:\b|[._ -])(\d{1,2})x(\d{2})(?:\b|[._ -])', stem)
    title, year = clean_title(stem[:episode.start()] if episode else stem)
    data = {'title': title, 'year': year, 'kind': 'episode' if episode else 'movie',
            'plot': '', 'genres': [], 'cast': [], 'directors': [], 'studios': [],
            'rating': 0, 'runtime': 0, 'collection': '', 'poster': '', 'backdrop': '',
            'gallery': [], 'show': title if episode else '', 'season': int(episode[1]) if episode else 0,
            'episode': int(episode[2]) if episode else 0, 'source': 'filename'}
    if episode: data['title'] = f'{title} · S{data["season"]:02}E{data["episode"]:02}'
    return data


def xml_file(path):
    """Bounded local XML only; external entities and DTDs are never accepted."""
    if path.stat().st_size > 1_000_000: raise ValueError('Metadata file is too large.')
    data = path.read_bytes()
    # Decode before checking, including UTF-16 XML. ElementTree will not resolve URLs.
    if data.startswith((b'\xff\xfe', b'\xfe\xff')): text = data.decode('utf-16')
    else:
        try: text = data.decode('utf-8-sig')
        except UnicodeDecodeError: text = data.decode('cp1250')
    if '\x00' in text or re.search(r'<!\s*(?:DOCTYPE|ENTITY)', text, re.I): raise ValueError('Unsupported XML declaration.')
    try: return ET.fromstring(text)
    except ET.ParseError: raise ValueError('Invalid metadata XML.') from None


def nfo_metadata(path):
    root = xml_file(path)
    if root.tag not in ('movie', 'episodedetails', 'tvshow'): return {}
    def text(key): return (root.findtext(key) or '').strip()[:10000]
    def many(key): return list(dict.fromkeys(part.strip() for node in root.findall(key) for part in re.split(r'\s*/\s*|\s*\|\s*', node.text or '') if part.strip()))[:30]
    posters = [(node.text or '').strip() for node in root.findall('thumb') if node.get('aspect', 'poster') in ('poster', 'thumb')]
    backdrops = [(node.text or '').strip() for node in root.findall('fanart/thumb')]
    poster = posters[0] if posters else ''
    collection = text('set/name') or (text('set') if not list(root.find('set') or []) else '')
    runtime = number(text('runtime')) * 60 or number(text('fileinfo/streamdetails/video/durationinseconds'))
    resume_node = root.find('resume')
    if resume_node is not None and resume_node.find('position') is not None:
        position = number(resume_node.findtext('position'))  # Kodi uses seconds.
        runtime = number(resume_node.findtext('total')) or runtime
    else:
        position = number(text('resume')) / 1000  # NOVA stores milliseconds.
    lastplayed = number(text('lastplayed'))
    if not lastplayed and text('lastplayed'):
        try: lastplayed = datetime.fromisoformat(text('lastplayed')).timestamp()
        except ValueError: pass
    watched = number(text('playcount')) > 0 or text('watched').lower() == 'true' or position == -0.002
    return {'title': text('title'), 'original_title': text('originaltitle'),
            'year': int(number(text('year') or text('aired')[:4])), 'plot': text('plot') or text('outline'),
            'genres': many('genre'), 'directors': many('director'), 'studios': many('studio'),
            'cast': [{'name': (node.findtext('name') or '')[:200], 'role': (node.findtext('role') or '')[:200]} for node in root.findall('actor')[:30]],
            'rating': number(text('rating') or text('ratings/rating/value')), 'runtime': runtime,
            'collection': collection, 'poster': poster, 'backdrop': backdrops[0] if backdrops else '',
            'gallery': list(dict.fromkeys(backdrops + posters))[:10], 'content_rating': text('mpaa'),
            'tmdb_id': int(number(text('tmdbid') or next((n.text for n in root.findall('uniqueid') if n.get('type') == 'tmdb'), '0'))),
            'kind': 'episode' if root.tag == 'episodedetails' else 'movie',
            'show': text('showtitle'), 'season': int(number(text('season'))), 'episode': int(number(text('episode'))),
            'source': 'nfo', 'position': max(0, position), 'watched': watched, 'lastplayed': lastplayed}


def nova_resume(path, video_name):
    """Port of XmlDb network_database reader; never follow the XML path field."""
    root = xml_file(path)
    if root.tag != 'network_database': return None
    if unquote(root.findtext('path') or '') != video_name: return None
    position = number(root.findtext('last_position'), -1)
    if position < 0 and position != -2: return None
    percent = re.search(r'\.(\d+)\.archos\.resume\.xml$', path.name)
    lastplayed = number(root.findtext('last_time_played'))
    # NOVA VideoDbInfo uses epoch seconds for lastTimePlayed.
    if lastplayed > 100_000_000_000: lastplayed /= 1000
    return {'position': max(0, position / 1000), 'lastplayed': lastplayed or path.stat().st_mtime,
            'watched': position == -2 or bool(percent and int(percent[1]) >= 95),
            'percent': min(100, int(percent[1])) if percent else 0,
            'external_stamp': f'{path.name}:{path.stat().st_mtime_ns}'}
