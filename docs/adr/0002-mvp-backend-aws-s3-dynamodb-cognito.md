# ADR 0002: MVP Backend — AWS S3 + DynamoDB + Cognito (Replaces Gitea)

Status: Accepted  
Date: 2026-04-02  
Supersedes: ADR 0001 (git primitives are replaced by DynamoDB/S3 equivalents; role model and workflow states are preserved)

## Context

The original plan used a self-hosted Gitea instance as the backend for document
storage, versioning, and review workflows (ADR 0001). Three problems invalidated
that approach for MVP:

1. **API quality.** Gitea's REST API has undocumented endpoints, CORS defaults
   that block SPA POST requests, and OAuth token exchange that doesn't emit
   correct CORS headers. Integration required constant empirical testing rather
   than reading docs.

2. **Permission management.** Gitea's permission model is designed for human
   GitHub users. Bindersnap users have no Gitea accounts. All permissions would
   have had to be re-implemented in a separate layer anyway, which made Gitea a
   dumb datastore with a complex operational footprint.

3. **Operational burden.** Self-hosting Gitea, keeping it patched, and running
   it reliably is ongoing work that does not compound into product value.

The replacement stack (S3 + DynamoDB + Cognito + Lambda) eliminates the
self-hosted dependency, uses managed AWS services with well-defined SDKs, keeps
the SPA as the only deployment artifact, and handles permissions natively in the
data model.

The workflow contract from ADR 0001 (upload → review → approve → publish) is
preserved. Only the backing primitives change.

---

## Decision

Use the following AWS-native stack for the Bindersnap MVP backend:

| Layer               | Service                                        | Purpose                                                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Identity            | Cognito User Pool                              | User accounts, email/password auth, Google OAuth                 |
| Credentials         | Cognito Identity Pool + STS                    | Exchange JWT for scoped IAM credentials                          |
| Auth                | Lambda + `jose`                                | Validate Cognito JWT on every mutating request                   |
| Document storage    | S3 (versioning enabled)                        | Immutable file storage; every PUT creates a new S3 VersionId     |
| Metadata + workflow | DynamoDB                                       | Collections, documents, memberships, versions, reviews, votes    |
| API                 | Lambda Function URLs (or API Gateway HTTP API) | Thin permission-checked router; no business logic                |
| File transfer       | S3 pre-signed URLs                             | SPA uploads/downloads directly to S3; Lambda never proxies bytes |

---

## Auth Flow

Users authenticate entirely within the Bindersnap SPA. No redirect to an
external identity page except for Google OAuth, which is opt-in.

```
Email/password flow (no redirect):

  SPA login form
    → Amplify signIn(email, password)
    → Cognito User Pool returns id_token + access_token + refresh_token
    → Amplify stores tokens; handles silent refresh automatically
    → Every Lambda request includes: Authorization: Bearer <id_token>
    → Lambda verifies token signature against Cognito JWKS endpoint

Google OAuth flow (redirect acceptable per product decision):

  SPA "Sign in with Google" button
    → Amplify signInWithRedirect({ provider: 'Google' })
    → Google → Cognito → back to SPA callback URL
    → Same token storage as above
```

Lambda JWT verification (runs on every mutating request):

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL(
    `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}/.well-known/jwks.json`,
  ),
);

async function verifyToken(authHeader: string): Promise<string> {
  const token = authHeader.replace("Bearer ", "");
  const { payload } = await jwtVerify(token, JWKS);
  return payload.sub as string; // Cognito user ID; stable primary key for all user references
}
```

---

## S3 Structure

One bucket: `bindersnap-documents-{awsAccountId}`

Versioning: **enabled on the bucket**. Every `PutObject` to the same key
automatically creates a new S3 VersionId. There are no branches or upload keys —
each document maps to exactly one S3 key, and S3 maintains the full history.

```
bindersnap-documents-{accountId}/
  {collectionId}/
    {documentId}          ← one key per document, all versions implicit in S3
```

S3 key policy: the bucket is private. No public access. All reads and writes go
through pre-signed URLs issued by Lambda after permission checks.

CORS on the bucket:

```json
[
  {
    "AllowedOrigins": ["https://app.bindersnap.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["x-amz-version-id", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`x-amz-version-id` must be exposed so the SPA can read the S3 VersionId from
the PUT response and pass it back to Lambda in the confirm-upload call.

---

## DynamoDB Schema

All tables use on-demand (PAY_PER_REQUEST) billing. All string IDs are UUIDs
unless noted. All timestamps are ISO 8601 UTC strings.

### Table: `bindersnap-collections`

| Attribute           | Type | Notes                                         |
| ------------------- | ---- | --------------------------------------------- |
| `collectionId` (PK) | S    | UUID                                          |
| `name`              | S    | Display name                                  |
| `description`       | S    | Optional                                      |
| `ownerId`           | S    | Cognito sub of creator                        |
| `createdAt`         | S    | ISO 8601                                      |
| `requiredApprovals` | N    | Minimum votes before merge allowed; default 1 |
| `allowedFileTypes`  | SS   | Set of extensions; empty set = all allowed    |

### Table: `bindersnap-memberships`

| Attribute           | Type | Notes                                                          |
| ------------------- | ---- | -------------------------------------------------------------- |
| `collectionId` (PK) | S    |                                                                |
| `userId` (SK)       | S    | Cognito sub                                                    |
| `role`              | S    | `viewer` \| `uploader` \| `reviewer` \| `publisher` \| `owner` |
| `addedAt`           | S    |                                                                |
| `addedBy`           | S    | Cognito sub of admin who granted access                        |

GSI: `userId-index` (PK: `userId`) — list all collections a user belongs to.

### Table: `bindersnap-documents`

| Attribute                | Type | Notes                                                                          |
| ------------------------ | ---- | ------------------------------------------------------------------------------ |
| `collectionId` (PK)      | S    |                                                                                |
| `documentId` (SK)        | S    | UUID                                                                           |
| `title`                  | S    |                                                                                |
| `documentSlug`           | S    | Stable lowercase kebab-case; unique within collection                          |
| `canonicalExtension`     | S    | e.g. `docx`, `pdf`; set on first upload; immutable                             |
| `currentVersionId`       | S    | S3 VersionId of the published version; null until first merge                  |
| `publishedVersionNumber` | N    | Monotonic counter; increments on each merge; maps to `doc/vNNNN` from ADR 0001 |
| `createdAt`              | S    |                                                                                |
| `createdBy`              | S    | Cognito sub                                                                    |
| `lastModifiedAt`         | S    |                                                                                |
| `lastModifiedBy`         | S    | Cognito sub                                                                    |

GSI: `documentSlug-index` (PK: `collectionId`, SK: `documentSlug`) — resolve slug to documentId.

### Table: `bindersnap-versions`

Each row is one uploaded file version (one S3 PutObject). Created during
confirm-upload, not at upload-request time (the S3 VersionId is unknown until
after the PUT completes).

| Attribute          | Type | Notes                                                          |
| ------------------ | ---- | -------------------------------------------------------------- |
| `documentId` (PK)  | S    |                                                                |
| `s3VersionId` (SK) | S    | The `x-amz-version-id` from S3 PUT response                    |
| `collectionId`     | S    | For access-pattern queries                                     |
| `versionNumber`    | N    | Null until published; set to `publishedVersionNumber` on merge |
| `uploadedBy`       | S    | Cognito sub                                                    |
| `uploadedAt`       | S    | ISO 8601                                                       |
| `originalFilename` | S    | User's filename before canonicalization                        |
| `fileSizeBytes`    | N    |                                                                |
| `sha256Hash`       | S    | Hex; computed client-side before upload, verified by Lambda    |
| `mimeType`         | S    |                                                                |
| `reviewId`         | S    | Set on merge; the review that published this version           |
| `status`           | S    | `pending` \| `available` \| `published`                        |

### Table: `bindersnap-reviews`

Each row is one review request (equivalent to a PR in ADR 0001).

| Attribute           | Type | Notes                                                                    |
| ------------------- | ---- | ------------------------------------------------------------------------ |
| `reviewId` (PK)     | S    | UUID                                                                     |
| `collectionId`      | S    |                                                                          |
| `documentId`        | S    |                                                                          |
| `title`             | S    |                                                                          |
| `description`       | S    | Optional                                                                 |
| `status`            | S    | `open` \| `approved` \| `changes_requested` \| `merged` \| `abandoned`   |
| `authorId`          | S    | Cognito sub                                                              |
| `createdAt`         | S    |                                                                          |
| `updatedAt`         | S    |                                                                          |
| `baseVersionId`     | S    | S3 VersionId of the current published version at time of review creation |
| `proposedVersionId` | S    | S3 VersionId being proposed for publication                              |

GSI: `collectionId-status-index` (PK: `collectionId`, SK: `status`) — list open reviews per collection.  
GSI: `documentId-index` (PK: `documentId`, SK: `createdAt`) — list reviews per document in order.

### Table: `bindersnap-review-votes`

| Attribute       | Type | Notes                          |
| --------------- | ---- | ------------------------------ |
| `reviewId` (PK) | S    |                                |
| `userId` (SK)   | S    | Cognito sub                    |
| `vote`          | S    | `approve` \| `request_changes` |
| `comment`       | S    | Optional                       |
| `votedAt`       | S    |                                |

One row per user per review. A second vote by the same user overwrites the first
(update, not append). Lambda counts rows with `vote = approve` when evaluating
merge eligibility.

---

## Upload Flow

Replaces the "upload branch" concept from ADR 0001. The upload branch name
convention is not reproduced — S3 VersionIds serve as the stable, sortable
version identifier.

```
1. SPA → POST /documents/{documentId}/upload-request
         Body: { originalFilename, fileSizeBytes, mimeType, sha256Hash }

2. Lambda:
   a. Verify JWT → get userId
   b. Check membership: role must be >= uploader
   c. Reject if fileSizeBytes > 26_214_400 (25 MiB)
   d. Validate sha256Hash is 64-char hex
   e. Call s3.getSignedUrl('putObject', { Key, ContentType, Metadata: { uploadedBy, originalFilename, sha256Hash } })
   f. Return: { presignedUrl, s3Key, expiresIn: 900 }

3. SPA → PUT <presignedUrl>
         Body: raw file bytes
         Headers: Content-Type: <mimeType>
   S3 Response Headers include: x-amz-version-id: <newVersionId>

4. SPA → POST /documents/{documentId}/confirm-upload
         Body: { s3VersionId, originalFilename, fileSizeBytes, mimeType, sha256Hash }

5. Lambda:
   a. Verify JWT
   b. Call s3.headObject({ Key, VersionId: s3VersionId }) to confirm object exists
      and metadata matches what was declared
   c. Write row to bindersnap-versions with status=available
   d. Return: { versionId: s3VersionId, uploadedAt }
```

---

## Review Workflow

Replaces the PR lifecycle from ADR 0001. Status transitions are identical;
backing store is DynamoDB instead of Gitea PR state.

```
States: open → approved | changes_requested → merged | abandoned

Transition rules:
  open           → changes_requested  : any reviewer or publisher casts request_changes vote
  changes_requested → open            : author submits a new version and calls /reopen
  open           → approved           : approve vote count >= collection.requiredApprovals
                                        (Lambda recomputes on every vote write)
  approved       → merged             : publisher or owner calls /merge
                                        blocked if status != approved
  any open state → abandoned          : owner or author calls /abandon
```

### Create a review

```
POST /reviews
Body: {
  collectionId,
  documentId,
  title,
  description,       // optional
  proposedVersionId  // s3VersionId from confirm-upload
}

Lambda checks:
  - role >= uploader
  - proposedVersionId exists in bindersnap-versions with status=available
  - no other open review exists for the same documentId (one open review per document)

Writes:
  - bindersnap-reviews row with status=open
  - Returns: { reviewId }
```

### Cast a vote

```
POST /reviews/{reviewId}/votes
Body: { vote: "approve" | "request_changes", comment }

Lambda checks:
  - role >= reviewer
  - review.status is open or changes_requested

Writes:
  - bindersnap-review-votes row (upsert by reviewId + userId)
  - Recount approve votes; if count >= requiredApprovals → update review.status=approved
  - If any vote is request_changes → update review.status=changes_requested
  - Returns: { reviewStatus }
```

### Merge a review

```
POST /reviews/{reviewId}/merge

Lambda checks:
  - role >= publisher
  - review.status == approved

Writes (all in one transactional write):
  - bindersnap-reviews: status=merged, updatedAt=now
  - bindersnap-documents: currentVersionId=review.proposedVersionId,
                          publishedVersionNumber += 1,
                          lastModifiedAt=now, lastModifiedBy=userId
  - bindersnap-versions (proposedVersionId row): status=published,
                          versionNumber=new publishedVersionNumber,
                          reviewId=reviewId
  Returns: { publishedVersionNumber, mergedAt }
```

The `publishedVersionNumber` is the equivalent of `doc/vNNNN` from ADR 0001.
Version 4 of a document is always `publishedVersionNumber == 4`, and the S3
VersionId for that snapshot is in `bindersnap-versions` where
`versionNumber == 4`.

---

## Lambda API Surface

Base path: `/api/v1`

All routes except `/auth/*` require `Authorization: Bearer <id_token>`.

### Collections

| Method | Path                                 | Min role   | Action                                  |
| ------ | ------------------------------------ | ---------- | --------------------------------------- |
| POST   | `/collections`                       | —          | Create collection; caller becomes owner |
| GET    | `/collections`                       | any member | List caller's collections               |
| GET    | `/collections/{id}`                  | any member | Get collection details + member list    |
| POST   | `/collections/{id}/members`          | owner      | Add member                              |
| PATCH  | `/collections/{id}/members/{userId}` | owner      | Update member role                      |
| DELETE | `/collections/{id}/members/{userId}` | owner      | Remove member                           |

### Documents

| Method | Path                                      | Min role | Action                                      |
| ------ | ----------------------------------------- | -------- | ------------------------------------------- |
| POST   | `/collections/{id}/documents`             | uploader | Create document record                      |
| GET    | `/collections/{id}/documents`             | viewer   | List documents in collection                |
| GET    | `/collections/{id}/documents/{docId}`     | viewer   | Get document metadata                       |
| POST   | `/documents/{docId}/upload-request`       | uploader | Get pre-signed PUT URL                      |
| POST   | `/documents/{docId}/confirm-upload`       | uploader | Register S3 VersionId in DynamoDB           |
| GET    | `/documents/{docId}/download`             | viewer   | Get pre-signed GET URL for current version  |
| GET    | `/documents/{docId}/download/{versionId}` | viewer   | Get pre-signed GET URL for specific version |
| GET    | `/documents/{docId}/versions`             | viewer   | List all versions with metadata             |

### Reviews

| Method | Path                          | Min role        | Action                                                          |
| ------ | ----------------------------- | --------------- | --------------------------------------------------------------- |
| POST   | `/reviews`                    | uploader        | Create review                                                   |
| GET    | `/collections/{id}/reviews`   | viewer          | List reviews (filterable by status)                             |
| GET    | `/reviews/{reviewId}`         | viewer          | Get review details + vote summary                               |
| POST   | `/reviews/{reviewId}/votes`   | reviewer        | Cast or update vote                                             |
| POST   | `/reviews/{reviewId}/merge`   | publisher       | Merge review (publish version)                                  |
| POST   | `/reviews/{reviewId}/abandon` | owner or author | Abandon review                                                  |
| POST   | `/reviews/{reviewId}/reopen`  | author          | Reopen after changes_requested (requires new proposedVersionId) |

---

## Role Model

Preserved from ADR 0001 without modification.

| Role      | Upload | Vote (review) | Merge | Manage members |
| --------- | ------ | ------------- | ----- | -------------- |
| viewer    | No     | No            | No    | No             |
| uploader  | Yes    | No            | No    | No             |
| reviewer  | No     | Yes           | No    | No             |
| publisher | No     | Yes           | Yes   | No             |
| owner     | Yes    | Yes           | Yes   | Yes            |

Enforcement: Lambda reads the `bindersnap-memberships` row for
`(collectionId, userId)` on every request and compares role to the minimum
required for that route. Role hierarchy for comparison:
`viewer < uploader < reviewer < publisher < owner`.

Note: `uploader` and `reviewer` are parallel, not sequential — an uploader
cannot approve their own upload without also holding the reviewer role. The owner
role implies all permissions.

---

## Mapping: ADR 0001 Git Concepts → This Architecture

| ADR 0001 (Gitea / git)                                | ADR 0002 (S3 + DynamoDB)                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Gitea repository per document                         | S3 prefix `{collectionId}/{documentId}` + DynamoDB rows              |
| Upload branch                                         | S3 object version (VersionId)                                        |
| Upload branch naming convention                       | S3 VersionId (auto-generated, sortable by creation time)             |
| PR from upload branch → main                          | `bindersnap-reviews` row                                             |
| PR status (open, approved, etc.)                      | `reviews.status` field                                               |
| Merge commit to `main`                                | DynamoDB transactional write updating reviews + documents + versions |
| Annotated tag `doc/vNNNN`                             | `documents.publishedVersionNumber` (integer)                         |
| Commit trailers (provenance metadata)                 | `bindersnap-versions` row attributes                                 |
| `main` HEAD = current version                         | `documents.currentVersionId` (S3 VersionId)                          |
| Historical version by tag                             | `bindersnap-versions` row where `versionNumber = N` → `s3VersionId`  |
| 25 MiB file size limit                                | Enforced in Lambda upload-request handler; unchanged                 |
| Role model (viewer/uploader/reviewer/publisher/owner) | `bindersnap-memberships.role`; unchanged                             |

---

## What Was Dropped

These ADR 0001 elements have no equivalent in this architecture and are not
reproduced:

1. **Git commit trailers as git objects.** Provenance metadata (uploader,
   original filename, SHA-256 hash) is stored in DynamoDB `bindersnap-versions`,
   not in git commit footers. The data is equivalent; the storage mechanism is not.

2. **Annotated git tags (`doc/vNNNN`).** Version numbers are stored as a
   monotonic integer in DynamoDB. The concept is identical; the git object is not.

3. **Upload branch naming convention
   (`upload/<slug>/<date>/<time>-<user>-<hash>`).** S3 VersionIds replace upload
   branches. Sortability by creation time is preserved natively by S3.

4. **`main` branch as canonical pointer.** `documents.currentVersionId` is the
   canonical pointer to the published version.

5. **Gitea Docker Compose dev stack.** The `tests/` Docker Compose stack is
   obsolete for this architecture. Local development uses AWS SAM CLI or
   LocalStack for Lambda + DynamoDB + S3 emulation. This is a separate ADR or
   issue.

---

## Open Questions

These are unresolved at the time of this ADR and should become GitHub Issues
before implementation begins on the relevant area.

1. **Review comments.** ADR 0001 used Gitea PR comments for reviewer feedback.
   There is no equivalent table in this schema. Options: (a) add a
   `bindersnap-review-comments` table, (b) use the `comment` field on
   `review-votes` as the only feedback channel for MVP, (c) defer entirely.
   Recommended: option (b) for MVP; option (a) post-launch.

2. **S3 event confirmation.** The confirm-upload step calls `s3.headObject` to
   verify the upload completed. Under high load, there may be a small window
   where HeadObject returns 404 before S3 replication completes. If this becomes
   a problem, add an SQS-backed S3 event notification as an alternative
   confirmation path.

3. **LocalStack vs SAM CLI for local dev.** The dev environment needs to
   emulate Cognito, S3, DynamoDB, and Lambda. LocalStack Pro supports all four;
   SAM CLI supports Lambda + S3 + DynamoDB but not Cognito. Decision needed
   before the first Lambda is written.

4. **SAML for enterprise customers.** Cognito User Pools support SAML 2.0
   federation natively. No changes to the Lambda or DynamoDB schema are needed —
   SAML is a Cognito configuration concern. This is a deployment-time concern,
   not a code concern.

5. **Soft delete vs hard delete for documents and collections.** Not specified.
   Recommend adding `deletedAt` to collections and documents tables and
   filtering in Lambda rather than deleting DynamoDB rows.

6. **Pre-signed URL expiry for large files.** The upload-request handler issues
   URLs with a 15-minute expiry. Files approaching 25 MiB on slow connections may
   time out. Consider making expiry configurable or issuing multipart upload
   credentials for files over a threshold (e.g. 10 MiB).

---

## Consequences

Positive:

1. SPA is the only deployment artifact Bindersnap manages. No self-hosted
   services.
2. Permission enforcement is in one place (DynamoDB + Lambda), not split between
   the git backend and an application layer.
3. S3 versioning provides an immutable audit trail suitable for regulated
   industries without any application-level logic.
4. Lambda scales to zero; cost at MVP scale is effectively $0.
5. Cognito handles email/password, Google OAuth, and enterprise SAML with no
   code changes.
6. Well-defined AWS SDKs replace empirical Gitea API exploration.

Tradeoffs:

1. The DynamoDB transact-write on merge must be written carefully to avoid
   partial state. Use `TransactWriteItems` for the merge operation; do not use
   individual PutItem calls.
2. There is no cryptographic chain between versions (git's commit graph). S3
   object integrity is guaranteed by AWS but is not independently verifiable by
   the user without AWS access. This may matter for some regulated-industry
   customers — document if so.
3. Replacing the git model means existing `tests/` tooling, the Gitea seed script,
   and any Playwright tests targeting Gitea must be retired or rewritten. Scope
   this as a migration issue before starting implementation.
