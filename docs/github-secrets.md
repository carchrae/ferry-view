# Setting up GitHub Deployment with Workload Identity

This is the recommended approach - it uses a dedicated service account without storing any secrets in GitHub.

## 1. Create Service Account

In **either** Firebase Console (staging or production):

1. Go to **IAM & Admin > Service Accounts**
2. Click **Create service account**
   - Name: `github-deploy`
   - Description: For GitHub Actions deployment`
3. Don't assign a role yet - click Done
4. Click on the newly created service account
5. Click **Permissions > Grant Access**
6. Add these roles:
   - **Cloud Functions Admin** (or create custom)

Repeat for the other project, or grant access to both projects.

## 2. Enable Workload Identity

In Google Cloud Console (not Firebase):

1. Go to **IAM & Admin > Workload Identity Federation**
2. Click **Connectors**
3. Click **New Connector**
   - Name: `github-actions`
   - Namespace: `projects/[YOUR_PROJECT_NUMBER]/locations/global`
   - Issuer: `https://token.actions.githubusercontent.com`
   - Allowed audiences: Choose your GitHub repo (e.g., `urn:oid:repo:owner/repo`)

Actually, the easier way is to use the GitHub action directly - it can create the workload identity automatically.

## 3. Alternative: Use Service Account Key (Simpler)

If workload identity is too complex:

1. Go to **IAM > Service Accounts**
2. Click the three dots next to your service account > **Manage keys**
3. **Add key** > **Create new key** > **JSON**
4. This downloads a JSON file - this is sensitive!

Then in GitHub secrets, add:
- `GCP_SA_KEY` - the entire JSON file contents

Update workflow:
```yaml
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}
```

## 4. GitHub Secrets to Add

| Secret | How to get |
|--------|------------|
| `WORKLOAD_IDENTITY_PROVIDER` | From GCP Workload Identity connector |
| `SERVICE_ACCOUNT_EMAIL` | The email like `github-deploy@PROJECT.iam.gserviceaccount.com` |

Or simpler approach - just add `FIREBASE_TOKEN` as before, but use a dedicated service account with limited permissions in Firebase.