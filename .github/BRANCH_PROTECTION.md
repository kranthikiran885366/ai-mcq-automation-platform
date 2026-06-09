# Branch Protection Rules
# Apply these settings in GitHub → Settings → Branches → Add rule

## Protected Branches: main, feature/*

### Rules for `main`:
- [x] Require a pull request before merging
- [x] Require approvals: 1 (must be @kranthikiran885366)
- [x] Require review from Code Owners (CODEOWNERS file)
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require status checks to pass before merging
- [x] Require branches to be up to date before merging
- [x] Do not allow bypassing the above settings
- [x] Restrict who can push to matching branches → only @kranthikiran885366
- [x] Block force pushes
- [x] Block deletions

### Rules for `feature/*`:
- [x] Require a pull request before merging
- [x] Require review from Code Owners
- [x] Block force pushes

## How to apply via GitHub CLI:
# gh api repos/kranthikiran885366/ai-mcq-automation-platform/branches/main/protection \
#   --method PUT \
#   --field required_status_checks=null \
#   --field enforce_admins=true \
#   --field required_pull_request_reviews[required_approving_review_count]=1 \
#   --field required_pull_request_reviews[require_code_owner_reviews]=true \
#   --field required_pull_request_reviews[dismiss_stale_reviews]=true \
#   --field restrictions=null
