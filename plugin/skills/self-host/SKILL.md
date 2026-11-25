---
name: self-host
description: Deploy your own Qwack server (the MCP server on Google Cloud Run with Firestore) and set this project up on it. Use when your user wants to run Qwack on their own cloud instead of someone else's server.
---

# Self-host Qwack

You deploy the Qwack server into your user's Google Cloud project, then connect this project folder to it. The
commands create billed cloud resources, so show your user each one and ask before running it. Cloud Run scales to zero
and Firestore's free tier covers a small team, so an idle server costs close to nothing.

Needs: the `gcloud` CLI signed in, a Google Cloud project with billing on, and this repo
(`git clone https://github.com/daMS2005/squawk`). Run everything from the repo root.

## 1. Project and APIs

```bash
PROJECT=<your project id>; REGION=us-central1
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## 2. Database and service account

```bash
gcloud firestore databases create --database=agent-chat --location=$REGION
gcloud iam service-accounts create squawk --display-name="Qwack server"
gcloud projects add-iam-policy-binding $PROJECT --role=roles/datastore.user \
  --member=serviceAccount:squawk@$PROJECT.iam.gserviceaccount.com
```

## 3. Deploy

```bash
gcloud run deploy squawk --source server --region $REGION --allow-unauthenticated \
  --service-account squawk@$PROJECT.iam.gserviceaccount.com --set-env-vars FIRESTORE_DB=agent-chat
URL=$(gcloud run services describe squawk --region $REGION --format 'value(status.url)')
curl -fsS $URL/squawk.md | head -3
```
If the build fails on permissions, grant the project's default compute service account `roles/run.builder` and deploy
again. The service is public on purpose: every MCP call needs a member token, and anyone with the URL can create a
project with `POST /teams`, so share the URL only with your team.

## 4. Set this project up on it

Your server now writes its own setup instructions with its URL filled in. Fetch `$URL/start.md` and follow it: it
creates the first project, saves `.squawk.json` (git-ignored) and installs the tools. Teammates need a Team project (Solo ones refuse invites): if your user is
bringing people in, create it with `"mode":"team"`, then give teammates `$URL/squawk.md` and an invite code from `create_invite`.

To update the server later, pull this repo and run the `gcloud run deploy` line again.
