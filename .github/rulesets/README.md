# Protected branches

`protected-branches.json` is the GitHub repository ruleset for the default
branch, `main`, and `dev` (if created). Feature branches remain unrestricted.
The active policy:

- Requires a pull request and one approving review from another contributor.
- Dismisses stale approvals after new commits and requires resolved discussions.
- Requires the branch to be up to date and **CI passed** from GitHub Actions
  (integration ID `15368`), not a same-named status from another integration.
- Blocks force pushes and deletion.
- Has no bypass actors, including administrators, apps, or deploy keys.

The aggregate check covers Linux checks/builds, Linux desktop/installers, and
Windows validation. Do not require release-only checks or enable a merge queue
without first adding its `merge_group` CI trigger.

## Apply or update

Committing this JSON does **not** configure GitHub. A repository administrator
must apply it with an authenticated GitHub CLI. Run these commands from the
repository root after reviewing the policy. They create the named ruleset only
when absent, otherwise update it in place. Inspect other rulesets before making
changes; this procedure leaves them untouched.

```sh
repo=CodeManufactoryLLC/code60
gh api "repos/$repo" --jq '.permissions.admin'
gh api "repos/$repo/rulesets"
ruleset_id=$(gh api "repos/$repo/rulesets" --paginate \
  --jq '.[] | select(.name == "Reviewed and validated branches") | .id') || exit 1
if [ -z "$ruleset_id" ]; then
  gh api --method POST "repos/$repo/rulesets" \
    --input .github/rulesets/protected-branches.json
else
  gh api --method PUT "repos/$repo/rulesets/$ruleset_id" \
    --input .github/rulesets/protected-branches.json
fi
```

Use a separate branch and reviewed PR for policy changes. Apply the approved
policy through the API as well; normal Actions tokens cannot administer rulesets.
No privileged token is needed in CI.

## Verify

```sh
gh api "repos/$repo/rulesets/$ruleset_id"
gh api "repos/$repo/rules/branches/main"
gh api "repos/$repo/branches/main" --jq '.protected'
npm test -- test/workflows.test.mjs
```

If the ruleset was just created, retrieve `ruleset_id` with the lookup above
before running verification. Check that enforcement is `active`, bypass actors
are empty, and the effective rules contain the PR, review, CI, force-push, and
deletion requirements. `main` must report `true` for protection. A missing `dev`
branch is not an error; its rule takes effect if that branch is created.

Tests guard the checked-in policy and its CI check name. API verification is
still required to detect changes made directly in GitHub settings.
