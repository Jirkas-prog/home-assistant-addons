"""Create a distributable add-on without local data or credentials."""
import hashlib
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
destination = root / 'releases'
destination.mkdir(exist_ok=True)
path = destination / 'workflow_fastshare-1.2.0.zip'
names = ['config.yaml', 'Dockerfile', '.dockerignore', 'requirements.txt', 'README.md', 'DOCS.md', 'CHANGELOG.md']
files = [root / name for name in names]
files += sorted((root / 'fastshare_app').glob('*.py'))
files += sorted((root / 'www').glob('*'))
with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, 'workflow_fastshare/' + file.relative_to(root).as_posix())
digest = hashlib.sha256(path.read_bytes()).hexdigest()
path.with_suffix('.zip.sha256').write_text(digest + '  ' + path.name + '\n', encoding='ascii')
print(path.name, len(files), 'files', path.stat().st_size, 'bytes', digest)
