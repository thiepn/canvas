from pathlib import Path
p = Path('scripts/phase8-retire-legacy.py')
text = p.read_text(encoding='utf-8')
old = "'tests/unit','tests/live'"
new = "'tests/live'"
if old not in text:
    raise SystemExit('Expected Phase 8 tsconfig include anchor is missing.')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Phase 8 typecheck surface corrected.')
