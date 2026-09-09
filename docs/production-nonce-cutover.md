# Production nonce protocol cutover

This runbook accompanies PR #5. It is an operator procedure, not a claim that the production change has already run. The GitHub workflow and Supabase migration history record the actual release outcome.

## Release conditions

The exact PR head must pass static checks, unit tests, Worker tests, live Excalidraw/Supabase tests, legacy browser regressions, and production-build tests. Live tests write only `canvas_ci_elements`, never `canvas_elements`.

After merge, the Pages job must deploy and pass `scripts/verify-deployed.mjs`. This checks the exact published entry module, the actual Supabase connection, offline/reconnect, and the 320px settings menu. It does not draw, erase, or modify public scene records.

Only then apply the following production trigger update through the authorized database migration tool, named `align_canvas_nonce_order_with_excalidraw`. Export its generated version and SQL from Supabase migration history when recording the release; do not invent a migration timestamp. For a fresh database replaying the older repository migrations, apply this same cutover after those migrations and before opening the new frontend to users.

## Forward SQL

```sql
create or replace function public.canvas_keep_newest_element()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then
      raise exception 'Canvas element IDs are immutable';
    end if;
    if new.version < old.version
       or (new.version = old.version and new.version_nonce >= old.version_nonce) then
      return null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;
```

Higher `version` wins; at equal version, lower `version_nonce` wins. Exact duplicates and stale writes are no-ops. Element IDs cannot be renamed. This matches the frontend comparator and the isolated CI trigger. The operation changes no scene rows, policies, grants, publication membership, or recovery-history triggers.

## Verification

Read the deployed function definition back. Test the actual production trigger function against a temporary table inside a transaction: increasing version, lower-nonce tie, rejected higher-nonce tie, exact duplicate, stale version, immutable ID, deletion and later restoration. Roll the transaction back. Do not insert verification shapes into the public canvas.

Check production row count/fingerprint before and after cutover, allowing for genuine concurrent user edits. Run the security advisor and inspect Canvas-specific findings; unrelated applications in the same Supabase project must not be modified as part of this release.

Existing open tabs retain their previous JavaScript until refreshed. Reload them after this protocol change. Deployment plus a trigger update is not an atomic transaction across every browser cache.

## Paired rollback

If rollback is required, restore the previous frontend and previous database ordering together. The previous trigger rejected `new.version_nonce <= old.version_nonce` for equal versions. Do not roll back only the trigger or only the frontend. Retain scene records and recovery history throughout; no truncation or scene reset is required.

## Reconnect regression coverage

The release tests verify that a temporarily offline client receives a peer's newer state after two successive reconnect cycles, restores presence, resumes real pointer drawing, and reloads the saved result. Pointer tests hit-test the actual canvas so the properties panel cannot masquerade as a drawing failure. Peer deletion waits for the peer's exported scene to contain the new object before erasing it.
