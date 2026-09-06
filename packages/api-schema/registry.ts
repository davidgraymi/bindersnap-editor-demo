import "./init-openapi";
import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Import all schemas AFTER calling extendZodWithOpenApi in init-openapi
import {
  SessionAuthStateSchema,
  LoginBodySchema,
  SignupBodySchema,
} from "./schemas/auth";
import {
  ChangeAssignmentsSchema,
  ChangeUpdatesPayloadSchema,
  ClosedChangesPayloadSchema,
  CollaboratorListPayloadSchema,
  CreateDiscussionBodySchema,
  DiscussionSummarySchema,
  DocumentDetailPayloadSchema,
  DocumentHistoryPayloadSchema,
  ResolveDiscussionBodySchema,
  SetCommentReactionBodySchema,
  DocumentPermissionsPayloadSchema,
  DocumentSearchResultsPayloadSchema,
  HomeChangesPayloadSchema,
  InitialDocumentUploadResultSchema,
  PublishDocumentBodySchema,
  PublishDocumentResultSchema,
  SubmitReviewBodySchema,
  UpdateChangeAssignmentsBodySchema,
  UpdatePermissionsBodySchema,
  UploadResultSchema,
  AddCollaboratorBodySchema,
  WorkspaceDocumentSummarySchema,
} from "./schemas/documents";
import { SearchUsersPayloadSchema } from "./schemas/users";
import {
  NewOrganizationBodySchema,
  CreatedOrganizationPayloadSchema,
  OrganizationListPayloadSchema,
  OrganizationSummarySchema,
} from "./schemas/organizations";
import {
  WorkspaceDocumentDetailPayloadSchema,
  WorkspaceDocumentEntrySchema,
  WorkspaceDocumentListPayloadSchema,
  CreatedWorkspaceDocumentPayloadSchema,
  CreatedWorkspacePayloadSchema,
  NewWorkspaceBodySchema,
  WorkspaceListPayloadSchema,
  WorkspaceSummarySchema,
} from "./schemas/workspaces";
import {
  BillingActionBodySchema,
  BillingStatusPayloadSchema,
  BillingUrlResultSchema,
} from "./schemas/billing";
import {
  AdminAccessUserResultSchema,
  AdminSubscriptionAccessListPayloadSchema,
  SetAdminAccessBodySchema,
} from "./schemas/admin";
import { RepoCollaboratorPermissionSummarySchema } from "./schemas/common";

export const registry = new OpenAPIRegistry();

// Register all component schemas
registry.register("SessionAuthState", SessionAuthStateSchema);
registry.register("LoginBody", LoginBodySchema);
registry.register("SignupBody", SignupBodySchema);
registry.register("WorkspaceDocumentSummary", WorkspaceDocumentSummarySchema);
registry.register("DocumentDetailPayload", DocumentDetailPayloadSchema);
registry.register("DocumentHistoryPayload", DocumentHistoryPayloadSchema);
registry.register(
  "InitialDocumentUploadResult",
  InitialDocumentUploadResultSchema,
);
registry.register("UploadResult", UploadResultSchema);
registry.register("CollaboratorListPayload", CollaboratorListPayloadSchema);
registry.register(
  "DocumentPermissionsPayload",
  DocumentPermissionsPayloadSchema,
);
registry.register("DiscussionSummary", DiscussionSummarySchema);
registry.register("ChangeUpdatesPayload", ChangeUpdatesPayloadSchema);
registry.register("SearchUsersPayload", SearchUsersPayloadSchema);
registry.register("OrganizationSummary", OrganizationSummarySchema);
registry.register("OrganizationListPayload", OrganizationListPayloadSchema);
registry.register("NewOrganizationBody", NewOrganizationBodySchema);
registry.register("WorkspaceSummary", WorkspaceSummarySchema);
registry.register("WorkspaceListPayload", WorkspaceListPayloadSchema);
registry.register("NewWorkspaceBody", NewWorkspaceBodySchema);
registry.register("WorkspaceDocumentEntry", WorkspaceDocumentEntrySchema);
registry.register(
  "CreatedOrganizationPayload",
  CreatedOrganizationPayloadSchema,
);
registry.register(
  "DocumentSearchResultsPayload",
  DocumentSearchResultsPayloadSchema,
);
registry.register("BillingStatusPayload", BillingStatusPayloadSchema);
registry.register(
  "AdminSubscriptionAccessListPayload",
  AdminSubscriptionAccessListPayloadSchema,
);

// Auth routes
registry.registerPath({
  method: "post",
  path: "/auth/login",
  operationId: "authLogin",
  tags: ["auth"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: LoginBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Session established",
      content: { "application/json": { schema: SessionAuthStateSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/signup",
  operationId: "authSignup",
  tags: ["auth"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: SignupBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Account created and session established",
      content: { "application/json": { schema: SessionAuthStateSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  operationId: "authMe",
  tags: ["auth"],
  responses: {
    200: {
      description: "Current session",
      content: { "application/json": { schema: SessionAuthStateSchema } },
    },
    401: { description: "Not authenticated" },
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  operationId: "authLogout",
  tags: ["auth"],
  responses: {
    204: { description: "Session ended" },
  },
});

// Document routes
registry.registerPath({
  method: "get",
  path: "/api/app/documents",
  operationId: "listDocuments",
  tags: ["documents"],
  request: {
    query: z.object({
      owner: z.string().optional(),
      member: z.string().optional(),
      q: z.string().optional(),
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of workspace documents",
      content: {
        "application/json": {
          schema: z.object({
            documents: z.array(WorkspaceDocumentSummarySchema),
            page: z.number(),
            limit: z.number(),
            /** Gitea reports no total, so a full page is the only hint of another. */
            hasMore: z.boolean(),
          }),
        },
      },
    },
  },
});

registry.register("HomeChangesPayload", HomeChangesPayloadSchema);

registry.registerPath({
  method: "get",
  path: "/api/app/home/changes",
  operationId: "getHomeChanges",
  tags: ["documents"],
  responses: {
    200: {
      description: "The change requests the reader is part of",
      content: {
        "application/json": { schema: HomeChangesPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/search",
  operationId: "searchDocuments",
  tags: ["documents"],
  request: {
    query: z.object({
      q: z.string(),
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of document search results",
      content: {
        "application/json": {
          schema: DocumentSearchResultsPayloadSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents",
  operationId: "createDocument",
  tags: ["documents"],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({
              type: "string",
              format: "binary",
              description: "File upload",
            }),
            repoName: z.string(),
            nextVersion: z.string(),
            requiredApprovals: z.string().optional(),
            description: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Document created",
      content: {
        "application/json": { schema: InitialDocumentUploadResultSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}",
  operationId: "getDocumentDetail",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      description: "Document detail",
      content: { "application/json": { schema: DocumentDetailPayloadSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/history",
  operationId: "getDocumentHistory",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      description: "Published versions with the reviews that approved them",
      content: { "application/json": { schema: DocumentHistoryPayloadSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/changes/closed",
  operationId: "getClosedChanges",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      description: "Changes that are no longer open, with how each one ended",
      content: { "application/json": { schema: ClosedChangesPayloadSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents/{owner}/{repo}/versions",
  operationId: "uploadDocumentVersion",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({
              type: "string",
              format: "binary",
              description: "File upload",
            }),
            docSlug: z.string(),
            uploaderSlug: z.string(),
            nextVersion: z.string(),
            canonicalFileName: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Version uploaded",
      content: { "application/json": { schema: UploadResultSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/download",
  operationId: "downloadDocument",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
    query: z.object({ ref: z.string().optional() }),
  },
  responses: {
    200: {
      description: "File download",
      content: {
        "application/octet-stream": {
          schema: z.string(),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/permissions",
  operationId: "getDocumentPermissions",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      description: "Document permissions",
      content: {
        "application/json": { schema: DocumentPermissionsPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/app/documents/{owner}/{repo}/permissions",
  operationId: "updateDocumentPermissions",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
    body: {
      required: true,
      content: { "application/json": { schema: UpdatePermissionsBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Permissions updated",
      content: {
        "application/json": { schema: DocumentPermissionsPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/collaborators",
  operationId: "listDocumentCollaborators",
  tags: ["documents"],
  request: {
    params: z.object({ owner: z.string(), repo: z.string() }),
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Collaborators list",
      content: {
        "application/json": { schema: CollaboratorListPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/app/documents/{owner}/{repo}/collaborators/{collaborator}",
  operationId: "addDocumentCollaborator",
  tags: ["documents"],
  request: {
    params: z.object({
      owner: z.string(),
      repo: z.string(),
      collaborator: z.string(),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: AddCollaboratorBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Collaborator added",
      content: {
        "application/json": {
          schema: z.object({
            collaborator:
              RepoCollaboratorPermissionSummarySchema.optional().nullable(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/documents/{owner}/{repo}/collaborators/{collaborator}",
  operationId: "removeDocumentCollaborator",
  tags: ["documents"],
  request: {
    params: z.object({
      owner: z.string(),
      repo: z.string(),
      collaborator: z.string(),
    }),
  },
  responses: {
    204: { description: "Collaborator removed" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/reviews",
  operationId: "submitDocumentReview",
  tags: ["documents"],
  request: {
    params: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.string(),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: SubmitReviewBodySchema } },
    },
  },
  responses: {
    204: { description: "Review submitted" },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/assignments",
  operationId: "updateChangeAssignments",
  tags: ["documents"],
  request: {
    params: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateChangeAssignmentsBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Assignee and reviewers updated",
      content: { "application/json": { schema: ChangeAssignmentsSchema } },
    },
  },
});

const discussionParams = z.object({
  owner: z.string(),
  repo: z.string(),
  pullNumber: z.string(),
});

const threadParams = discussionParams.extend({ threadId: z.string() });

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/discussions",
  operationId: "listDocumentDiscussions",
  tags: ["documents"],
  request: { params: discussionParams },
  responses: {
    200: {
      description: "Review discussion threads",
      content: { "application/json": { schema: DiscussionSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/discussions",
  operationId: "createDocumentDiscussion",
  tags: ["documents"],
  request: {
    params: discussionParams,
    body: {
      required: true,
      content: { "application/json": { schema: CreateDiscussionBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Thread started",
      content: { "application/json": { schema: DiscussionSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/discussions/{threadId}/comments",
  operationId: "replyToDocumentDiscussion",
  tags: ["documents"],
  request: {
    params: threadParams,
    body: {
      required: true,
      content: { "application/json": { schema: CreateDiscussionBodySchema } },
    },
  },
  responses: {
    201: {
      description: "Reply posted",
      content: { "application/json": { schema: DiscussionSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/discussions/{threadId}/resolve",
  operationId: "resolveDocumentDiscussion",
  tags: ["documents"],
  request: {
    params: threadParams,
    body: {
      required: true,
      content: { "application/json": { schema: ResolveDiscussionBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Thread status updated",
      content: { "application/json": { schema: DiscussionSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/discussions/{threadId}/comments/{commentId}/reactions",
  operationId: "setDiscussionCommentReaction",
  tags: ["documents"],
  request: {
    params: threadParams.extend({ commentId: z.string() }),
    body: {
      required: true,
      content: { "application/json": { schema: SetCommentReactionBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Reaction added or taken back",
      content: { "application/json": { schema: DiscussionSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/updates",
  operationId: "listChangeUpdates",
  tags: ["documents"],
  request: { params: discussionParams },
  responses: {
    200: {
      description: "Every update this change has proposed, oldest first",
      content: { "application/json": { schema: ChangeUpdatesPayloadSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/documents/{owner}/{repo}/pull-requests/{pullNumber}/publish",
  operationId: "publishDocument",
  tags: ["documents"],
  request: {
    params: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.string(),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: PublishDocumentBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Document published",
      content: {
        "application/json": { schema: PublishDocumentResultSchema },
      },
    },
  },
});

// Users route
registry.registerPath({
  method: "get",
  path: "/api/app/users/search",
  operationId: "searchUsers",
  tags: ["users"],
  request: {
    query: z.object({
      q: z.string(),
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "User search results",
      content: { "application/json": { schema: SearchUsersPayloadSchema } },
    },
  },
});

// Organization routes
registry.registerPath({
  method: "get",
  path: "/api/app/organizations",
  operationId: "listOrganizations",
  tags: ["organizations"],
  responses: {
    200: {
      description: "The organizations this session belongs to",
      content: {
        "application/json": { schema: OrganizationListPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/organizations",
  operationId: "createOrganization",
  tags: ["organizations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: NewOrganizationBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "The organization and its trial",
      content: {
        "application/json": { schema: CreatedOrganizationPayloadSchema },
      },
    },
  },
});

// Workspace routes
registry.registerPath({
  method: "get",
  path: "/api/app/binders",
  operationId: "listBinders",
  tags: ["workspaces"],
  responses: {
    200: {
      description:
        "Every binder this session can act in, each naming its organization",
      content: {
        "application/json": { schema: WorkspaceListPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/orgs/{org}/binders",
  operationId: "listOrganizationBinders",
  tags: ["workspaces"],
  request: { params: z.object({ org: z.string() }) },
  responses: {
    200: {
      description: "The binders this organization owns",
      content: {
        "application/json": { schema: WorkspaceListPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/orgs/{org}/binders",
  operationId: "createBinder",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: NewWorkspaceBodySchema },
      },
    },
  },
  responses: {
    201: {
      description: "The binder, its role teams and its protected main",
      content: {
        "application/json": { schema: CreatedWorkspacePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/documents",
  operationId: "listBinderDocuments",
  tags: ["workspaces"],
  request: { params: z.object({ org: z.string(), binder: z.string() }) },
  responses: {
    200: {
      description: "The binder's documents",
      content: {
        "application/json": { schema: WorkspaceDocumentListPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/documents/{documentPath}",
  operationId: "getBinderDocument",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      /** File path or identity — a URL may carry either. */
      documentPath: z.string(),
    }),
  },
  responses: {
    200: {
      description: "One document, with its published versions",
      content: {
        "application/json": { schema: WorkspaceDocumentDetailPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/raw/{documentPath}",
  operationId: "downloadBinderDocument",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      /** File path or identity — a URL may carry either. */
      documentPath: z.string(),
    }),
    /** A version tag, a change's branch, or `main` when unstated. */
    query: z.object({ ref: z.string().optional() }),
  },
  responses: {
    200: {
      description: "The document's bytes, at that ref",
      content: { "application/octet-stream": { schema: z.string() } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/documents",
  operationId: "createBinderDocument",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({
              type: "string",
              format: "binary",
              description: "File upload",
            }),
            /** The title. Slugified into the path segment. */
            name: z.string(),
            /** Optional directory inside the binder. Nests as deep as wanted. */
            folder: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The document's path, and the change that will publish it",
      content: {
        "application/json": {
          schema: CreatedWorkspaceDocumentPayloadSchema,
        },
      },
    },
  },
});

// Billing routes
registry.registerPath({
  method: "get",
  path: "/api/app/billing/status",
  operationId: "getBillingStatus",
  tags: ["billing"],
  responses: {
    200: {
      description: "Billing status",
      content: { "application/json": { schema: BillingStatusPayloadSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/billing/checkout",
  operationId: "createBillingCheckout",
  tags: ["billing"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: BillingActionBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Checkout URL",
      content: { "application/json": { schema: BillingUrlResultSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/billing/portal",
  operationId: "createBillingPortal",
  tags: ["billing"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: BillingActionBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Portal URL",
      content: { "application/json": { schema: BillingUrlResultSchema } },
    },
  },
});

// Admin routes
registry.registerPath({
  method: "get",
  path: "/api/app/admin/subscriptions/access",
  operationId: "listAdminSubscriptionAccess",
  tags: ["admin"],
  request: {
    query: z.object({
      q: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Admin subscription access list",
      content: {
        "application/json": {
          schema: AdminSubscriptionAccessListPayloadSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/app/admin/subscriptions/access/{username}",
  operationId: "setAdminSubscriptionAccess",
  tags: ["admin"],
  request: {
    params: z.object({ username: z.string() }),
    body: {
      required: true,
      content: { "application/json": { schema: SetAdminAccessBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Access updated",
      content: {
        "application/json": { schema: AdminAccessUserResultSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/admin/subscriptions/access/{username}",
  operationId: "clearAdminSubscriptionAccess",
  tags: ["admin"],
  request: {
    params: z.object({ username: z.string() }),
  },
  responses: {
    204: { description: "Access cleared" },
  },
});

export default registry;
