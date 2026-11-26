"""Persistent file-backed publishing queue. No Instagram requests happen here."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import unicodedata
import uuid
from urllib.parse import urlsplit


class QueueError(ValueError):
    pass


class QueueConflict(QueueError):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _slug(name):
    stem = re.sub(r"^\d{4,}[_ -]+", "", Path(name).stem)
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-_")[:150]
    return stem or "post"


class QueueStore:
    def __init__(self, queue_dir: Path, data_dir: Path):
        queue_dir, data_dir = Path(queue_dir), Path(data_dir)
        if queue_dir.is_symlink() or data_dir.is_symlink():
            raise QueueError("The queue and data folders must not be symbolic links.")
        queue_dir.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)
        self.queue_dir = queue_dir.resolve()
        self.data_dir = data_dir.resolve()
        self.archive_dir = self.queue_dir.parent / "PUBLISHED"
        if self.archive_dir.is_symlink():
            raise QueueError("The archive folder must not be a symbolic link.")
        self.archive_dir.mkdir(exist_ok=True)
        self.journal_path = self.data_dir / "queue-rename-journal.json"
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(self.data_dir / "queue.sqlite3"), timeout=30,
                                  isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY, filename TEXT NOT NULL, caption_filename TEXT NOT NULL,
            original_filename TEXT NOT NULL, slug TEXT NOT NULL, sha256 TEXT NOT NULL,
            caption TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, position INTEGER NOT NULL,
            error TEXT NOT NULL DEFAULT '', archive_path TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS queue_position ON items(status, position);
        CREATE TABLE IF NOT EXISTS attempts (
            attempt_id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id),
            event_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, filename TEXT NOT NULL,
            caption TEXT NOT NULL, container_id TEXT NOT NULL DEFAULT '',
            media_id TEXT NOT NULL DEFAULT '', permalink TEXT NOT NULL DEFAULT '',
            error TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
            publish_started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        """)
        with self._transaction():
            # Existing publications never gain a story retroactively. New claims
            # explicitly snapshot their story choice and its rendering settings.
            columns = {row['name'] for row in self.db.execute('PRAGMA table_info(attempts)')}
            story_columns = {
                'story_requested': 'INTEGER NOT NULL DEFAULT 0',
                'story_state': "TEXT NOT NULL DEFAULT 'skipped'",
                'story_settings': "TEXT NOT NULL DEFAULT '{}'",
                'story_media_id': "TEXT NOT NULL DEFAULT ''",
                'story_permalink': "TEXT NOT NULL DEFAULT ''",
                'story_error': "TEXT NOT NULL DEFAULT ''",
                'story_started_at': 'TEXT',
                'story_updated_at': 'TEXT',
                'story_note': "TEXT NOT NULL DEFAULT ''",
                'story_history': "TEXT NOT NULL DEFAULT '[]'",
            }
            for name, definition in story_columns.items():
                if name not in columns:
                    self.db.execute(f'ALTER TABLE attempts ADD COLUMN {name} {definition}')

    def close(self):
        with self.lock:
            self.db.close()

    @contextmanager
    def _file_lock(self):
        # SQLite protects row updates; this lock also spans journal COMMIT + cleanup.
        with (self.data_dir / "queue-process.lock").open("a+b") as stream:
            stream.seek(0, os.SEEK_END)
            if stream.tell() == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == "nt":
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    @contextmanager
    def _transaction(self):
        with self.lock, self._file_lock():
            self.db.execute("BEGIN IMMEDIATE")
            try:
                if self.journal_path.exists():
                    plan = json.loads(self.journal_path.read_text("utf-8"))
                    self._execute_plan(plan)
                    self.db.commit()
                    self.journal_path.unlink()
                    self.db.execute("BEGIN IMMEDIATE")
                yield
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise
            else:
                # A journal remains through COMMIT. Replaying after a crash is idempotent.
                if self.journal_path.exists():
                    self.journal_path.unlink()

    def _write_journal(self, plan):
        temporary = self.journal_path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(plan, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.journal_path)
        self._sync_directory(self.data_dir)

    @staticmethod
    def _sync_directory(directory):
        if os.name != "nt":
            descriptor = os.open(directory, os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)

    def _file(self, name, archived=None):
        if not isinstance(name, str) or Path(name).name != name or name in ("", ".", ".."):
            raise QueueError("Invalid file name.")
        folder = self.queue_dir if not archived else self.archive_dir / archived
        if archived and not re.fullmatch(r"[0-9a-f]{32}", archived):
            raise QueueError("Invalid archive path.")
        if folder.is_symlink():
            raise QueueError("Symbolic links are not allowed in the queue.")
        path = folder / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise QueueError("The item is not a regular file.")
        return path

    def _journal_file(self, value):
        path = Path(value)
        resolved = path.resolve()
        if not (resolved.parent == self.queue_dir or
                (resolved.parent.parent == self.archive_dir and re.fullmatch(r"[0-9a-f]{32}", resolved.parent.name))):
            raise QueueError("The journal points outside the queue and archive.")
        if path.is_symlink() or path.parent.is_symlink() or (path.exists() and not path.is_file()):
            raise QueueError("The journal contains an unsafe path.")
        return path

    def _move_no_replace(self, source: Path, target: Path, expected: str):
        source, target = self._journal_file(str(source)), self._journal_file(str(target))
        if target.exists():
            if source.exists():
                if not os.path.samefile(source, target):
                    raise QueueConflict(f"Target file already exists: {target.name}")
                if _hash(target) != expected:
                    raise QueueConflict("The file changed during renaming.")
                source.unlink()
            elif _hash(target) != expected:
                raise QueueConflict("Rename recovery encountered a different file.")
            return
        if not source.exists() or _hash(source) != expected:
            raise QueueConflict(f"The source is missing or changed during renaming: {source.name}")
        target.parent.mkdir(exist_ok=True)
        if os.name == "nt":
            # Unlike POSIX rename, Windows rename never replaces an existing file.
            os.rename(source, target)
            return
        # link+unlink is a no-replace move on POSIX, where rename would overwrite.
        # Queue and archive must share a filesystem with hard-link support.
        os.link(source, target, follow_symlinks=False)
        if _hash(target) != expected:
            raise QueueConflict("The file changed while being moved; the queue remains locked.")
        source.unlink()
        for directory in {source.parent, target.parent}:
            self._sync_directory(directory)

    def _execute_plan(self, plan):
        if plan.get("version") != 1:
            raise QueueError("Unknown queue journal format.")
        moves = plan["moves"]
        stage = plan.get("stage", 0)
        for current_stage in range(stage, 2):
            start = plan.get("index", 0) if current_stage == plan.get("stage", 0) else 0
            for index in range(start, len(moves)):
                move = moves[index]
                source = move["source"] if current_stage == 0 else move["temporary"]
                target = move["temporary"] if current_stage == 0 else move["target"]
                self._move_no_replace(Path(source), Path(target), move["sha256"])
                plan.update(stage=current_stage, index=index + 1)
                self._write_journal(plan)
            plan.update(stage=current_stage + 1, index=0)
            self._write_journal(plan)
        # Imports must survive a crash before SQLite COMMIT as well as renames.
        for item in plan.get("imports", []):
            self.db.execute("""INSERT OR IGNORE INTO items
                (id,filename,caption_filename,original_filename,slug,sha256,caption,status,
                 position,error,archive_path,created_at,updated_at)
                VALUES (:id,:filename,:caption_filename,:original_filename,:slug,:sha256,:caption,
                        :status,:position,:error,:archive_path,:created_at,:updated_at)""", item)
        for item in plan["items"]:
            self.db.execute("""UPDATE items SET filename=?,caption_filename=?,position=?,status=?,
                archive_path=?,updated_at=? WHERE id=?""",
                (item["filename"], item["caption_filename"], item["position"], item["status"],
                 item.get("archive_path"), plan["timestamp"], item["id"]))
        published = plan.get("published")
        if published:
            self.db.execute("""UPDATE attempts SET state='published',media_id=?,permalink=?,
                error='',updated_at=? WHERE attempt_id=?""",
                (published["media_id"], published["permalink"], plan["timestamp"], published["attempt_id"]))

    def _active(self):
        return [dict(row) for row in self.db.execute("SELECT * FROM items WHERE status!='published' ORDER BY position,id")]

    def _row(self, item_id):
        row = self.db.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise QueueError("Post not found.")
        return dict(row)

    def _attempt(self, attempt_id):
        row = self.db.execute("SELECT * FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
        if row is None:
            raise QueueError("Publishing attempt not found.")
        return self._attempt_record(row)

    @staticmethod
    def _attempt_record(row):
        result = dict(row)
        result['story_requested'] = bool(result['story_requested'])
        result['story_settings'] = json.loads(result['story_settings'])
        result['story_history'] = json.loads(result['story_history'])
        return result

    def _latest(self, item_id):
        row = self.db.execute("SELECT * FROM attempts WHERE item_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1", (item_id,)).fetchone()
        return self._attempt_record(row) if row else None

    def _check_mutable(self):
        if self.db.execute("SELECT 1 FROM items WHERE status='publishing' LIMIT 1").fetchone():
            raise QueueConflict("Publishing is in progress. Change the order after it finishes.")

    def _renumber(self, ordered, imports=None, archived=None, published=None):
        if len(ordered) > 9999:
            raise QueueError("The queue supports at most 9999 active posts.")
        timestamp = _now()
        updates, moves = [], []
        used = set()
        for position, item in enumerate(ordered, 1):
            extension = Path(item["filename"]).suffix.lower()
            new_name = f"{position:04d}__{item['slug']}{extension}"
            caption_name = str(Path(new_name).with_suffix(".txt"))
            for name in (new_name, caption_name):
                if name.casefold() in used:
                    raise QueueConflict("Two files would have the same name.")
                used.add(name.casefold())
            updates.append({"id": item["id"], "filename": new_name,
                            "caption_filename": caption_name, "position": position,
                            "status": item["status"], "archive_path": None})
            for old, new in ((item["filename"], new_name), (item["caption_filename"], caption_name)):
                if old != new:
                    moves.append((self._file(old), self._file(new)))
        if archived:
            destination = self.archive_dir / archived["id"]
            if destination.exists() and (destination.is_symlink() or any(destination.iterdir())):
                raise QueueConflict("The target post archive already exists.")
            destination.mkdir(exist_ok=True)
            self._sync_directory(self.archive_dir)
            for name in (archived["filename"], archived["caption_filename"]):
                moves.append((self._file(name), self._file(name, archived["id"])))
            updates.append({"id": archived["id"], "filename": archived["filename"],
                            "caption_filename": archived["caption_filename"], "position": 0,
                            "status": "published", "archive_path": archived["id"]})
        sources = {str(source).casefold() for source, _ in moves}
        for source, target in moves:
            if not source.exists():
                raise QueueConflict(f"File missing: {source.name}")
            if target.exists() and str(target).casefold() not in sources:
                raise QueueConflict(f"Target file already exists: {target.name}")
        plan = {"version": 1, "stage": 0, "index": 0, "timestamp": timestamp,
                "items": updates, "imports": imports or [], "published": published, "moves": []}
        transaction = uuid.uuid4().hex
        for index, (source, target) in enumerate(moves):
            temporary = self.queue_dir / f".queue-{transaction}-{index}.tmp"
            if temporary.exists():
                raise QueueConflict("The temporary rename path already exists.")
            plan["moves"].append({"source": str(source), "target": str(target),
                                  "temporary": str(temporary), "sha256": _hash(source)})
        if moves or imports or published:
            self._write_journal(plan)
            self._execute_plan(plan)
        else:
            for item in updates:
                self.db.execute("UPDATE items SET position=?,updated_at=? WHERE id=?",
                                (item["position"], timestamp, item["id"]))

    def list_items(self):
        with self._transaction():
            return self._active()

    def get(self, item_id):
        with self._transaction():
            return self._row(item_id)

    def image_path(self, item_id):
        with self._transaction():
            item = self._row(item_id)
            path = self._file(item["filename"], item["archive_path"])
            if not path.exists() or _hash(path) != item["sha256"]:
                raise QueueConflict("The image is missing or has changed since import. Restore the original file.")
            return path

    def import_pairs(self, pairs):
        """Stage complete upload pairs, then publish them with the existing journal.

        Before the journal exists only hidden files are written. Once it exists,
        every queue transaction recovers all image/caption moves and their records
        before a scan or claim can see a partially imported post.
        """
        staged = []
        try:
            with self._transaction():
                self._check_mutable()
                active = self._active()
                if len(active) + len(pairs) > 9999:
                    raise QueueError("The queue supports at most 9999 active posts.")
                transaction = uuid.uuid4().hex
                imports = []
                for index, pair in enumerate(pairs):
                    original = self._file(pair['filename']).name
                    image_bytes, caption_bytes = pair['image'], pair['caption']
                    caption = caption_bytes.decode('utf-8-sig')
                    if len(caption) > 2200:
                        raise QueueError("The caption exceeds 2200 characters.")
                    image_name = f'.upload-{transaction}-{index}{Path(original).suffix.lower()}'
                    caption_name = pair.get('caption_source') or f'.upload-{transaction}-{index}.txt'
                    payloads = [(image_name, image_bytes)]
                    if pair.get('caption_source'):
                        if self._file(caption_name).read_bytes() != caption_bytes:
                            raise QueueConflict("The file changed during renaming.")
                    else:
                        payloads.append((caption_name, caption_bytes))
                    for name, payload in payloads:
                        path = self._file(name)
                        digest = hashlib.sha256(payload).hexdigest()
                        with path.open('xb') as stream:
                            identity = os.fstat(stream.fileno())
                            staged.append((path, digest, identity.st_dev, identity.st_ino))
                            stream.write(payload)
                            stream.flush()
                            os.fsync(stream.fileno())
                    now = _now()
                    imports.append({
                        'id': uuid.uuid4().hex, 'filename': image_name,
                        'caption_filename': caption_name, 'original_filename': original,
                        'slug': _slug(original), 'sha256': hashlib.sha256(image_bytes).hexdigest(),
                        'caption': caption, 'status': 'queued', 'position': len(active) + index + 1,
                        'error': '', 'archive_path': None, 'created_at': now, 'updated_at': now,
                    })
                self._sync_directory(self.queue_dir)
                self._renumber(active + imports, imports=imports)
                return self._active()
        except BaseException:
            # A journal owns its staging files until recovery finishes. Without one,
            # remove only our unchanged hidden files; a hard process exit leaves
            # hidden orphans that scan deliberately ignores, never a captionless post.
            if not self.journal_path.exists():
                for path, digest, device, inode in staged:
                    try:
                        stat = path.stat(follow_symlinks=False)
                        if (not path.is_symlink() and (stat.st_dev, stat.st_ino) == (device, inode)
                                and _hash(path) == digest):
                            path.unlink()
                    except OSError:
                        pass
            raise

    def scan(self):
        with self._transaction():
            active = self._active()
            # An in-flight attempt owns the snapshot. New files are picked up after it.
            if any(item["status"] == "publishing" for item in active):
                return active
            known_names = {item["filename"].casefold() for item in active}
            known_captions = {item["caption_filename"].casefold() for item in active}
            for item in active:
                try:
                    image = self._file(item["filename"])
                    caption = self._file(item["caption_filename"])
                    if not image.exists() or _hash(image) != item["sha256"]:
                        raise QueueConflict("The image is missing or has changed since import.")
                    if not caption.exists():
                        raise QueueConflict("The caption file is missing.")
                    text = caption.read_text("utf-8-sig")
                    if len(text) > 2200:
                        raise QueueConflict("The caption exceeds 2200 characters.")
                    if text != item["caption"] and item["status"] == "queued":
                        item["caption"] = text
                        self.db.execute("UPDATE items SET caption=?,updated_at=? WHERE id=?", (text, _now(), item["id"]))
                except (OSError, UnicodeError, QueueError) as exc:
                    status = "uncertain" if item["status"] == "uncertain" else "error"
                    item.update(status=status, error=str(exc))
                    self.db.execute("UPDATE items SET status=?,error=?,updated_at=? WHERE id=?",
                                    (status, str(exc), _now(), item["id"]))
            incoming = sorted((path for path in self.queue_dir.iterdir()
                               if path.suffix.lower() in (".jpg", ".jpeg", ".png")
                               and not path.name.startswith(".") and path.name.casefold() not in known_names),
                              key=lambda path: (path.name.casefold(), path.name))
            imports = []
            for path in incoming:
                path = self._file(path.name)
                candidates = [path.with_suffix(".txt"), path.with_name(path.stem + "__caption.txt")]
                present = [candidate for candidate in candidates if candidate.exists()]
                if len(present) > 1:
                    raise QueueConflict(f"Multiple caption files for {path.name}; keep only one.")
                caption = present[0] if present else candidates[0]
                caption = self._file(caption.name)
                if caption.name.casefold() in known_captions:
                    raise QueueConflict(f"Multiple images share the caption {caption.name}.")
                known_captions.add(caption.name.casefold())
                if not caption.exists():
                    with caption.open("x", encoding="utf-8") as stream:
                        stream.write("")
                text = caption.read_text("utf-8-sig")
                if len(text) > 2200:
                    raise QueueError(f"Caption {caption.name} exceeds 2200 characters.")
                now = _now()
                item = {"id": uuid.uuid4().hex, "filename": path.name,
                        "caption_filename": caption.name, "original_filename": path.name,
                        "slug": _slug(path.name), "sha256": _hash(path), "caption": text,
                        "status": "queued", "position": len(active) + len(imports) + 1,
                        "error": "", "archive_path": None, "created_at": now, "updated_at": now}
                imports.append(item)
            if imports:
                self._renumber(active + imports, imports=imports)
            return self._active()

    def reorder(self, ids):
        if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids):
            raise QueueError("The order must be a list of IDs.")
        with self._transaction():
            self._check_mutable()
            active = self._active()
            by_id = {item["id"]: item for item in active}
            if len(ids) != len(by_id) or len(ids) != len(set(ids)) or set(ids) != set(by_id):
                raise QueueConflict("The queue has changed. Refresh it and move the post again.")
            self._renumber([by_id[item_id] for item_id in ids])
            return self._active()

    def update_caption(self, item_id, text):
        if not isinstance(text, str) or len(text) > 2200:
            raise QueueError("The caption must be text with at most 2200 characters.")
        with self._transaction():
            item = self._row(item_id)
            if item["status"] not in ("queued", "error"):
                raise QueueConflict("The caption of an in-flight or published post cannot be changed.")
            path = self._file(item["caption_filename"])
            temporary = self.queue_dir / f".caption-{uuid.uuid4().hex}.tmp"
            with temporary.open("x", encoding="utf-8") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            self.db.execute("UPDATE items SET caption=?,updated_at=? WHERE id=?", (text, _now(), item_id))
            return self._row(item_id)

    def attempt_for_event(self, event_key):
        """Return the durable receipt for a scheduling slot or manual request."""
        with self._transaction():
            row = self.db.execute('SELECT * FROM attempts WHERE event_key=?', (event_key,)).fetchone()
            return self._attempt_record(row) if row else None

    def claim(self, event_key, expected_item_id=None, story_settings=None):
        if not isinstance(event_key, str) or not 1 <= len(event_key) <= 500:
            raise QueueError("Invalid publishing slot identifier.")
        if story_settings is not None and not isinstance(story_settings, dict):
            raise QueueError('Invalid story publication settings.')
        story_json = json.dumps(story_settings or {}, ensure_ascii=False)
        if len(story_json) > 16384:
            raise QueueError('Invalid story publication settings.')
        with self._transaction():
            if self.db.execute("SELECT 1 FROM attempts WHERE event_key=?", (event_key,)).fetchone():
                return None
            active = self._active()
            if expected_item_id is not None:
                if not active or active[0]['id'] != expected_item_id:
                    raise QueueConflict('The next post changed. Refresh the queue and try again.')
                if active[0]['status'] != 'queued':
                    raise QueueConflict('The next post is not ready. Resolve its error or uncertain result first.')
            if not active or active[0]["status"] != "queued" or any(item["status"] == "publishing" for item in active):
                return None
            item = active[0]
            image = self._file(item["filename"])
            caption = self._file(item["caption_filename"])
            if not image.exists() or _hash(image) != item["sha256"] or not caption.exists():
                self.db.execute("UPDATE items SET status='error',error=?,updated_at=? WHERE id=?",
                                ("A file is missing or has changed before publishing.", _now(), item["id"]))
                return None
            text = caption.read_text("utf-8-sig")
            if len(text) > 2200:
                raise QueueError("The caption exceeds 2200 characters.")
            attempt_id, now = uuid.uuid4().hex, _now()
            self.db.execute("""INSERT INTO attempts
                (attempt_id,item_id,event_key,state,filename,caption,created_at,updated_at,
                 story_requested,story_state,story_settings,story_updated_at)
                VALUES (?,?,?,'claimed',?,?,?,?,?,?,?,?)""",
                (attempt_id, item["id"], event_key, item["filename"], text, now, now,
                 int(story_settings is not None), 'pending' if story_settings is not None else 'skipped', story_json, now))
            self.db.execute("UPDATE items SET status='publishing',caption=?,error='',updated_at=? WHERE id=?", (text, now, item["id"]))
            return self._attempt(attempt_id)

    def update_attempt(self, attempt_id, **fields):
        allowed = {"state", "container_id", "media_id", "permalink", "error", "note"}
        if not fields or set(fields) - allowed or any(not isinstance(value, str) for value in fields.values()):
            raise QueueError("Invalid attempt update.")
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt["state"] in ("published", "confirmed_not_published"):
                raise QueueConflict("A closed attempt cannot be overwritten.")
            if fields.get("state") not in (None, "claimed", "container_created", "publishing", "error", "uncertain"):
                raise QueueError("Use finish/fail/resolve_not_published to save this state.")
            values = dict(fields, updated_at=_now())
            if fields.get("state") == "publishing" and not attempt["publish_started_at"]:
                values["publish_started_at"] = _now()
            self.db.execute("UPDATE attempts SET " + ",".join(f"{field}=?" for field in values) + " WHERE attempt_id=?",
                            (*values.values(), attempt_id))
            return self._attempt(attempt_id)

    def get_attempt(self, attempt_id):
        with self._transaction():
            return self._attempt(attempt_id)

    def open_attempts(self):
        with self._transaction():
            return [self._attempt_record(row) for row in self.db.execute("SELECT * FROM attempts WHERE state IN ('claimed','container_created','publishing','uncertain') ORDER BY created_at")]

    def history(self):
        with self._transaction():
            return [self._attempt_record(row) for row in self.db.execute("SELECT * FROM attempts ORDER BY created_at DESC,rowid DESC LIMIT 500")]

    def open_stories(self):
        with self._transaction():
            return [self._attempt_record(row) for row in self.db.execute(
                "SELECT * FROM attempts WHERE story_state IN ('pending','preparing','publishing','uncertain') ORDER BY created_at")]

    def create_story(self, attempt_id, settings):
        """Explicitly backfill one skipped story; never infer work from history."""
        if not isinstance(settings, dict) or not settings:
            raise QueueError('Invalid story publication settings.')
        snapshot = json.dumps(settings, ensure_ascii=False)
        if len(snapshot) > 16384:
            raise QueueError('Invalid story publication settings.')
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt['state'] != 'published':
                raise QueueConflict('A story can only be created for a confirmed published feed post.')
            if attempt['story_state'] != 'skipped':
                return attempt, False
            if attempt['story_started_at'] or attempt['story_media_id'] or attempt['story_permalink']:
                raise QueueConflict('This story already has a publication result. Check its history before continuing.')
            item = self._row(attempt['item_id'])
            if item['status'] != 'published' or not item['archive_path']:
                raise QueueConflict('The published post archive is not available. Restore its original image first.')
            source = self._file(item['filename'], item['archive_path'])
            if not source.is_file() or _hash(source) != item['sha256']:
                raise QueueConflict('The published post archive is not available. Restore its original image first.')
            self._story_audit(attempt, 'manual_create', 'Story creation explicitly requested for this already-published feed post.')
            self.db.execute("""UPDATE attempts SET story_requested=1,story_state='pending',story_settings=?,
                story_error='',story_updated_at=? WHERE attempt_id=?""", (snapshot, _now(), attempt_id))
            return self._attempt(attempt_id), True

    def claim_story(self, attempt_id):
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt['state'] != 'published' or attempt['story_state'] != 'pending':
                return None
            self.db.execute("UPDATE attempts SET story_state='preparing',story_error='',story_updated_at=? WHERE attempt_id=?",
                            (_now(), attempt_id))
            return self._attempt(attempt_id)

    def start_story(self, attempt_id):
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt['state'] != 'published' or attempt['story_state'] != 'preparing' or attempt['story_started_at']:
                raise QueueConflict('This story has already been sent or is not ready to publish.')
            now = _now()
            self.db.execute("UPDATE attempts SET story_state='publishing',story_started_at=?,story_updated_at=? WHERE attempt_id=?",
                            (now, now, attempt_id))

    def finish_story(self, attempt_id, media_id, permalink, confirmed=False):
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt['story_state'] == 'published':
                return attempt
            expected = attempt['story_settings'].get('expected_username', '')
            try:
                parsed = urlsplit(permalink)
                match = re.fullmatch(r'/stories/([A-Za-z0-9_.]{1,30})/([0-9]+)/?', parsed.path)
                valid = (isinstance(media_id, str) and media_id.isdigit() and match
                         and match[1].casefold() == expected.casefold() and match[2] == media_id
                         and parsed.scheme == 'https' and parsed.hostname in ('instagram.com', 'www.instagram.com')
                         and parsed.port in (None, 443) and not parsed.username and not parsed.password)
            except (ValueError, TypeError):
                valid = False
            if not valid:
                raise QueueError('Provide the verified Instagram story URL for the original feed account.')
            allowed = ('uncertain',) if confirmed else ('publishing',)
            if attempt['state'] != 'published' or attempt['story_state'] not in allowed:
                raise QueueConflict('This story has no active publication to confirm.')
            permalink = f'https://www.instagram.com/stories/{expected}/{media_id}/'
            if confirmed:
                self._story_audit(attempt, 'confirmed_published', 'Verified story URL supplied by the user.')
            self.db.execute("""UPDATE attempts SET story_state='published',story_media_id=?,story_permalink=?,
                story_error='',story_updated_at=? WHERE attempt_id=?""", (media_id, permalink, _now(), attempt_id))
            return self._attempt(attempt_id)

    def fail_story(self, attempt_id, message):
        if not isinstance(message, str):
            raise QueueError('The story error must be text.')
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt['story_state'] in ('published', 'skipped'):
                raise QueueConflict('A closed story cannot be marked as failed.')
            state = 'uncertain' if attempt['story_started_at'] else 'error'
            self.db.execute('UPDATE attempts SET story_state=?,story_error=?,story_updated_at=? WHERE attempt_id=?',
                            (state, message, _now(), attempt_id))
            return self._attempt(attempt_id)

    def _story_audit(self, attempt, action, note):
        history = list(attempt['story_history'])
        history.append({key: attempt[key] for key in (
            'story_state', 'story_error', 'story_media_id', 'story_permalink', 'story_started_at', 'story_updated_at')}
            | {'action': action, 'note': note, 'at': _now()})
        self.db.execute('UPDATE attempts SET story_history=?,story_note=? WHERE attempt_id=?',
                        (json.dumps(history, ensure_ascii=False), note, attempt['attempt_id']))

    def retry_story(self, attempt_id):
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if (attempt['state'] != 'published' or not attempt['story_requested'] or attempt['story_state'] != 'error'
                    or attempt['story_started_at'] or attempt['story_media_id'] or attempt['story_permalink']):
                raise QueueConflict('Only a story failure before sending can be retried. Verify an uncertain story first.')
            self._story_audit(attempt, 'retry', 'Story retry requested by the user.')
            self.db.execute("UPDATE attempts SET story_state='pending',story_error='',story_updated_at=? WHERE attempt_id=?",
                            (_now(), attempt_id))
            return self._attempt(attempt_id)

    def resolve_story_not_published(self, attempt_id, note):
        if not isinstance(note, str) or len(note.strip()) < 8 or len(note) > 2000:
            raise QueueError('Describe how you verified that the story was not published.')
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt['state'] != 'published' or attempt['story_state'] != 'uncertain':
                raise QueueConflict('Manual confirmation is only available for an uncertain story.')
            self._story_audit(attempt, 'confirmed_not_published', note.strip())
            self.db.execute("""UPDATE attempts SET story_state='error',story_started_at=NULL,story_media_id='',
                story_permalink='',story_error='The story was verified as not published. You may retry only the story.',
                story_updated_at=? WHERE attempt_id=?""", (_now(), attempt_id))
            return self._attempt(attempt_id)

    def finish(self, attempt_id, media_id, permalink):
        if media_id is None:
            media_id = ""
        if not isinstance(media_id, str) or not isinstance(permalink, str) or not permalink.startswith("https://"):
            raise QueueError("Publication requires a verified HTTPS link.")
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt["state"] == "published":
                return attempt
            item = self._row(attempt["item_id"])
            if item["status"] == "published" or self._latest(item["id"])["attempt_id"] != attempt_id:
                raise QueueConflict("This post has a newer attempt or has already been archived.")
            # Record the known external result BEFORE touching files. If a NAS is
            # temporarily unavailable, recovery has proof and never posts again.
            now = _now()
            self.db.execute("""UPDATE attempts SET state='publishing',media_id=?,permalink=?,
                publish_started_at=COALESCE(publish_started_at,?),updated_at=? WHERE attempt_id=?""",
                (media_id, permalink, now, now, attempt_id))
            self.db.execute("UPDATE items SET status='publishing',updated_at=? WHERE id=?", (now, item["id"]))
        with self._transaction():
            attempt = self._attempt(attempt_id)
            item = self._row(attempt["item_id"])
            remaining = [row for row in self._active() if row["id"] != item["id"]]
            self._renumber(remaining, archived=item,
                           published={"attempt_id": attempt_id, "media_id": media_id, "permalink": permalink})
            return self._attempt(attempt_id)

    def fail(self, attempt_id, message, uncertain=False):
        if not isinstance(message, str):
            raise QueueError("The error must be text.")
        with self._transaction():
            attempt = self._attempt(attempt_id)
            if attempt["state"] in ("published", "confirmed_not_published"):
                raise QueueConflict("A closed attempt cannot be marked as failed.")
            if self._latest(attempt["item_id"])["attempt_id"] != attempt_id:
                raise QueueConflict("A newer publishing attempt exists for this post.")
            uncertain = uncertain or bool(attempt["publish_started_at"] or attempt["media_id"] or attempt["permalink"])
            state, now = ("uncertain" if uncertain else "error"), _now()
            self.db.execute("UPDATE attempts SET state=?,error=?,updated_at=? WHERE attempt_id=?", (state, message, now, attempt_id))
            if state == 'error':
                self.db.execute("""UPDATE attempts SET story_state='skipped',story_error='The feed post was not published.',
                    story_updated_at=? WHERE attempt_id=? AND story_state='pending'""", (now, attempt_id))
            self.db.execute("UPDATE items SET status=?,error=?,updated_at=? WHERE id=?", (state, message, now, attempt["item_id"]))
            return self._attempt(attempt_id)

    def retry(self, item_id):
        with self._transaction():
            item, attempt = self._row(item_id), self._latest(item_id)
            if item["status"] != "error" or (attempt and attempt["state"] != "confirmed_not_published"
                    and (attempt["publish_started_at"] or attempt["media_id"] or attempt["permalink"])):
                raise QueueConflict("Only failures before sending can be retried. Verify an uncertain result on the profile first.")
            image = self._file(item["filename"])
            caption = self._file(item["caption_filename"])
            if not image.exists() or _hash(image) != item["sha256"] or not caption.exists():
                raise QueueConflict("Restore the original image and caption first.")
            self.db.execute("UPDATE items SET status='queued',error='',updated_at=? WHERE id=?", (_now(), item_id))
            return self._row(item_id)

    def resolve_not_published(self, item_id, note):
        if not isinstance(note, str) or len(note.strip()) < 8:
            raise QueueError("Describe how you verified that the post was not published.")
        with self._transaction():
            item, attempt = self._row(item_id), self._latest(item_id)
            if item["status"] != "uncertain" or not attempt or attempt["state"] != "uncertain":
                raise QueueConflict("Manual confirmation is only available for an uncertain publishing result.")
            now = _now()
            self.db.execute("UPDATE attempts SET state='confirmed_not_published',note=?,updated_at=? WHERE attempt_id=?", (note.strip(), now, attempt["attempt_id"]))
            self.db.execute("""UPDATE attempts SET story_state='skipped',story_error='The feed post was not published.',
                story_updated_at=? WHERE attempt_id=? AND story_state='pending'""", (now, attempt['attempt_id']))
            self.db.execute("UPDATE items SET status='queued',error='',updated_at=? WHERE id=?", (now, item_id))
            return self._row(item_id)
