"""Owned format/budget fixtures; no competition results or desktop apps."""
import csv, importlib.util, tempfile, unittest, zipfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('artifact_inspector',Path(__file__).resolve().parents[1]/'scripts/inspect_artifact.py')
inspector=importlib.util.module_from_spec(spec);spec.loader.exec_module(inspector)

class ArtifactContracts(unittest.TestCase):
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
