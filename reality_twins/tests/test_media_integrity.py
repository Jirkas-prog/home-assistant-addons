from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.service import Service


class IntegrityTests(unittest.TestCase):
    def test_changed_bytes_after_claim_are_never_prepared_for_meta(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = Service(root / 'data', root / 'share' / 'PLANNED')
            Image.new('RGB', (400, 500), 'red').save(service.queue.queue_dir / 'example.jpg')
            item = service.queue.scan()[0]
            service.queue.claim('slot-1')
            Image.new('RGB', (400, 500), 'blue').save(service.queue.image_path(item['id']))
            with self.assertRaisesRegex(ValueError, 'changed since import'):
                service.media_url(item['id'])
            self.assertEqual(service.state.data['grants'], {})
            service.queue.db.close()


if __name__ == '__main__':
    unittest.main()
