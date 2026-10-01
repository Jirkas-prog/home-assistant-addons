# V3 verification

Verified on 2026-10-01 in an isolated local library. Personal records were not used for write tests.

## Automated checks

- 46 application tests pass, including seven new V3 acceptance tests.
- Three repository-level add-on tests pass; unrelated add-on files are unchanged.
- Manual journal/card metadata changes update conditional snapshots, search, counts and saved-view results.
- Bills account for other active planned demand, exclude themselves from subtraction, stop counting completed plans and escape formula prefixes in shopping CSV.
- Procedure starts are idempotent; source edits preserve existing run snapshots. Checklist writes reject stale revisions, persist through restart and correctly reopen completed runs.
- Review submissions persist, deduplicate retries and reject conflicting concurrent writers. Date arithmetic crosses month boundaries correctly.
- Invalid files remain preserved alongside healthy records. Incoming tool references prevent destructive archiving.
- Production build, language scan and add-on configuration/version/Dockerfile/logo/template checks pass.

## Browser acceptance

- English: created a journal with a project, two tags, 45 minutes and a next step.
- English: created a bill requiring eight units against five available units; three missing units appeared in the shopping list.
- English: created a two-step procedure, started a run, completed both steps and reloaded. The run remained completed.
- English: created a source-linked flashcard, revealed its answer and rated it Good. Its next review was 2026-10-02 and its review count was one.
- English: saved a tag-filtered view. A directly written Markdown record appeared without import or page refresh; a direct journal edit changed the displayed minutes from 45 to 90.
- Czech: navigation, tool details and editor labels translated while user-authored record text stayed unchanged.
- Czech: recovered an unpublished journal draft, detected an external concurrent tag edit, reviewed the merge and saved the draft's next step while preserving the external tag.

## Version separation

V2 remains on its preserved source checkpoint. V3 has a separate Git checkout, source, dependencies, build and personal data directory. All 42 original personal files matched the relocation SHA-256 manifest immediately after the move. Configuration document roots are remapped per copy; the project folder reference is updated with record history retained.

Both local launchers were exercised: V2 serves port 8102 and V3 serves port 8099. Each reports its own version and data directory, 38 personal records and no record validation errors. Browser write acceptance uses a separate test library on port 8113. The running personal library starts with no fabricated V3 tool records.

The V3 Home Assistant manifest has its own slug, `knowledge_atlas_v3`. No real Home Assistant instance or functioning local Docker engine was available for deployment acceptance. The eleven optional/later V3 proposals and unfinished V2 roadmap items are not claimed as implemented.
