import unittest
from pathlib import Path
import shutil
from tools.build_config import ROOT

class TestBundle(unittest.TestCase):
    def test_bundle_includes_all_assets(self):
        source = ROOT / 'preview'
        target = ROOT / 'ios/KappaForge/Web'
        # Ensure critical files exist in source
        self.assertTrue((source / 'index.html').exists())
        self.assertTrue((source / 'design.css').exists())
        self.assertTrue((source / 'icon.svg').exists())
        
        # Run bundle script
        import subprocess
        subprocess.run(['python3', str(ROOT / 'scripts/bundle-web.py')], check=True)
        
        # Verify they exist in target
        self.assertTrue((target / 'index.html').exists())
        self.assertTrue((target / 'design.css').exists())
        self.assertTrue((target / 'icon.svg').exists())

if __name__ == '__main__':
    unittest.main()