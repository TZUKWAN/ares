"""Owned format/budget fixtures; no competition results or desktop apps."""
import csv, importlib.util, tempfile, unittest, zipfile, shutil
from pathlib import Path

spec=importlib.util.spec_from_file_location('artifact_inspector',Path(__file__).resolve().parents[1]/'scripts/inspect_artifact.py')
inspector=importlib.util.module_from_spec(spec);spec.loader.exec_module(inspector)

class ArtifactContracts(unittest.TestCase):
    def test_ffprobe_reads_real_media_at_a_unicode_path(self):
        self.assertIsNotNone(shutil.which('ffprobe'), 'Media validation requires an installed ffprobe; this is an environment prerequisite, not a passed media check')
        source=Path(__file__).resolve().parents[1]/'assets/neural-reference/orb.mp4'
        with tempfile.TemporaryDirectory(prefix='ares-media-') as root:
            target=Path(root)/'作品 视频.mp4';shutil.copyfile(source,target)
            result=inspector.inspect(str(target),'mp4')
            self.assertTrue(result['valid'],result.get('error'))
            self.assertEqual(result['details']['format']['filename'],str(target))
            self.assertTrue(any(stream.get('codec_type')=='video' for stream in result['details']['streams']))

    def test_office_extension_cannot_be_checked_as_plain_text(self):
        with tempfile.TemporaryDirectory(prefix='ares-format-') as root:
            file=Path(root)/'fixture.docx';file.write_text('Explicit plain-text software fixture',encoding='utf-8')
            self.assertFalse(inspector.inspect(str(file),'md')['valid'])
            self.assertFalse(inspector.inspect(str(file))['valid'])

    def test_compressed_packages_have_a_budget_before_office_parsing(self):
        with tempfile.TemporaryDirectory(prefix='ares-archive-') as root:
            file=Path(root)/'fixture.docx'
            with zipfile.ZipFile(file,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                with archive.open('word/document.xml','w') as member:
                    for _ in range(65):member.write(b'x'*(1024*1024))
            result=inspector.inspect(str(file),'docx')
            self.assertFalse(result['valid']);self.assertIn('解压',result['error'])

    def test_csv_columns_are_consistent_and_counts_do_not_depend_on_preview_limit(self):
        with tempfile.TemporaryDirectory(prefix='ares-table-') as root:
            file=Path(root)/'fixture.csv'
            with file.open('w',newline='',encoding='utf-8') as stream:
                writer=csv.writer(stream);writer.writerow(['source_file','bytes'])
                for source in sorted(Path(__file__).parent.glob('*.mjs')):writer.writerow([source.name,source.stat().st_size])
            result=inspector.inspect(str(file),'csv');self.assertTrue(result['valid'],result)
            self.assertEqual(result['details']['rows'],len(list(Path(__file__).parent.glob('*.mjs'))))
            file.write_text('one,two\na,b,extra\n',encoding='utf-8')
            self.assertFalse(inspector.inspect(str(file),'csv')['valid'])

if __name__=='__main__':unittest.main()
