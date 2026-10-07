# Security

Last updated: October 7, 2026
Version: 2026-10-07

Your organization trusts Bindersnap with its evidence: every version, approval and review of its documents. This page explains how we protect that record. We also say plainly what we don't have yet. Bindersnap is a small, founder-run company, and we would rather be exact than impressive.

## Where Bindersnap runs

Bindersnap runs on one Amazon Web Services (AWS) server in the us-east-1 region (Northern Virginia, USA). Everything runs on that server in separate containers: our API, the Gitea server that stores documents as git repositories, the real-time collaboration server, a Caddy web server, and Litestream for database backups.

Our public website and the app's files are hosted on GitHub Pages. GitHub never receives your organization's documents.

Because Bindersnap runs on one server in one region, a serious failure there would mean downtime while we restore from backups. We don't offer an uptime guarantee (SLA) yet.

## Encryption

- **In transit.** Every connection to Bindersnap uses TLS (HTTPS). On our server, Caddy manages the certificates, which come from Let's Encrypt. GitHub Pages provides the certificate for our public website. Our API refuses connections that aren't HTTPS.
- **At rest.** The server's disks are encrypted with AWS-managed keys. Our backup storage (Amazon S3) blocks all public access and uses S3's default server-side encryption.
- **Browser protections.** Our API and document server send security headers that stop other sites from framing them (`X-Frame-Options: DENY`), stop browsers from guessing file types (`nosniff`), and keep our addresses from leaking to other sites (same-origin referrer policy). Our public website and the app's files are served by GitHub Pages, which doesn't let us set these headers.

## Backups

- **Continuous.** Litestream copies our databases to a private, versioned S3 bucket as they change. These hold document metadata, settings and sessions. Old versions are deleted after 30 days.
- **Daily.** We snapshot the data disk every day at 03:00 UTC and keep the last 7 snapshots.

Deleted information remains in backups until it ages out, up to 7 days for snapshots and 30 days for database backups.

## Who can reach the servers

- No one can log in to the server over SSH. That port is closed.
- Admin access goes only through AWS Systems Manager, using a short-lived key that expires after about 60 seconds.
- Deployments run from our CI system using GitHub's short-lived identity tokens (OIDC). There are no long-lived deploy keys.
- Passwords and keys live in AWS Systems Manager Parameter Store, never in our code.
- Our team is the founder. That keeps the number of people with access to one.

## Who can see and change your documents

- Each binder has its own roles: admins, authors and reviewers.
- Nothing reaches a binder's published record without the approvals that binder requires. The document server enforces this, not just the app's screens.
- An approved version can't be edited. It can only be replaced by a newer version, which goes through approval again. The earlier version stays on the record.
- Only organization owners can delete a binder, and they must type its name to confirm.

## How the app protects accounts

- **Your browser never holds a key to your documents.** Our server sits between your browser and the document server and keeps the access tokens on the server side. Your browser gets only a session cookie that page scripts can't read (HttpOnly).
- **Sessions end at sign-out.** Signing out revokes that session's access token.
- **Narrow internal access.** Our own service accounts are split by power: read-only accounts for reading, and admin accounts only where admin power is needed.
- **Passwords and tokens are stored hashed.** The document server hashes passwords. We store password-reset and email-confirmation tokens only as SHA-256 hashes.
- **Rate limits.** We limit repeated sign-in and account requests to slow down password guessing.
- **Email confirmation.** An account can't be used until its owner confirms their email address, either with the link we send or by accepting an invitation sent to that address.
- **No third-party scripts.** The app loads no analytics, advertising or other third-party code. Its fonts and profile pictures come from Bindersnap itself, not from Google, Gravatar or any other outside service.

## Monitoring

AWS CloudWatch alarms alert us to failed server health checks and to high CPU, disk or memory use. Server logs are kept for 30 days.

## If something goes wrong

If we confirm that a security incident has affected your organization's data, we will:

- notify your organization's owners without undue delay, and within 72 hours of confirming it
- tell you what happened, what data was involved, and what we're doing about it
- keep you updated until it's resolved

Section 8 of our Data Processing Addendum at [/legal/dpa](/legal/dpa) sets out these commitments in contract form.

## What we don't have (yet)

- **No certifications.** We are not SOC 2, ISO 27001 or HITRUST certified, and we haven't had a third-party audit. This page describes what we actually do. Ask us anything that isn't covered here.
- **Not for HIPAA.** Bindersnap is not for Protected Health Information or patient records. We don't sign Business Associate Agreements. Policies and procedures are fine. Patient data is not.
- **No uptime guarantee.** See "Where Bindersnap runs" above.

## Reporting a vulnerability

If you think you've found a security problem, email [security@bindersnap.com](mailto:security@bindersnap.com). Please include:

- what you found and where
- steps to reproduce it
- what an attacker could do with it

We ask that you:

- give us reasonable time to fix it before telling anyone else
- use only your own accounts and data, and stop if you reach anyone else's
- avoid anything that harms the service or its users, such as denial-of-service attacks or spam

If you act in good faith under these rules, we won't take legal action against you, and we'll credit you if you'd like.
