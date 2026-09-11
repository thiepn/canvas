from pathlib import Path
p = Path('scripts/phase8-retire-legacy.py')
text = p.read_text(encoding='utf-8')
old = "'tests/unit','tests/live'"
new = "'tests/live'"
if old not in text:
    raise SystemExit('Expected Phase 8 tsconfig include anchor is missing.')
text = text.replace(old, new, 1)
old_assertion = "assert.throws(() => createLiveConfig('https://example.com', ''));"
new_assertion = "assert.equal(createLiveConfig('https://example.com', '').supabaseKey, DEFAULT_SUPABASE_PUBLISHABLE_KEY);"
if old_assertion not in text:
    raise SystemExit('Expected blank-key assertion anchor is missing.')
text = text.replace(old_assertion, new_assertion, 1)
p.write_text(text, encoding='utf-8')
print('Phase 8 typecheck surface and production config expectation corrected.')
