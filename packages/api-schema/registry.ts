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
  PublishedWorkspaceChangePayloadSchema,
  WorkspaceChangeListPayloadSchema,
  BinderGroupRequestSchema,
  BinderPeoplePayloadSchema,
  BinderPersonRequestSchema,
  BinderVisibilityRequestSchema,
  BinderGroupsPayloadSchema,
  CreateOrganizationGroupRequestSchema,
  CreatedOrganizationGroupPayloadSchema,
  OrganizationGroupMemberRequestSchema,
  AddOrganizationPersonRequestSchema,
  OrganizationPersonRoleRequestSchema,
  LibraryPayloadSchema,
  LibrarySearchPayloadSchema,
  BinderRulesPayloadSchema,
  BinderRulesRequestSchema,
  OrganizationPeoplePayloadSchema,
  ProposedSignOffChangeSchema,
  SignOffRulesRequestSchema,
  BinderShapeChangePayloadSchema,
  BinderArchivePayloadSchema,
  BinderDraftPayloadSchema,
  ProposedDraftPayloadSchema,
  WorkspaceHistoryPayloadSchema,
  WorkspaceSettingsPayloadSchema,
  WorkspaceOverviewPayloadSchema,
  WorkspaceChangeDetailPayloadSchema,
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
      /** Plain words, matched against the name, the path and the binder. */
      q: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Every document in every binder this person can reach",
      content: {
        "application/json": { schema: LibraryPayloadSchema },
      },
    },
  },
});

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
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "The best matches, capped — quick find, not the library",
      content: {
        "application/json": { schema: LibrarySearchPayloadSchema },
      },
    },
  },
});

const discussionParams = z.object({
  owner: z.string(),
  repo: z.string(),
  pullNumber: z.string(),
});

const threadParams = discussionParams.extend({ threadId: z.string() });

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
  path: "/api/app/binders/{org}/{binder}",
  operationId: "getBinder",
  tags: ["workspaces"],
  request: { params: z.object({ org: z.string(), binder: z.string() }) },
  responses: {
    200: {
      description: "The binder, and how much is in it",
      content: {
        "application/json": { schema: WorkspaceOverviewPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/changes",
  operationId: "listBinderChanges",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    query: z.object({ state: z.enum(["open", "closed"]).optional() }),
  },
  responses: {
    200: {
      description: "The binder's change requests, open or closed",
      content: {
        "application/json": { schema: WorkspaceChangeListPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/orgs/{org}/people",
  operationId: "getOrganizationPeople",
  tags: ["organizations"],
  request: { params: z.object({ org: z.string() }) },
  responses: {
    200: {
      description: "Who is in this organization, and the groups it has",
      content: {
        "application/json": { schema: OrganizationPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/orgs/{org}/people",
  operationId: "addOrganizationPerson",
  tags: ["organizations"],
  request: {
    params: z.object({ org: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: AddOrganizationPersonRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The organization's people and groups, after the change",
      content: {
        "application/json": { schema: OrganizationPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/orgs/{org}/people/{username}/role",
  operationId: "setOrganizationPersonRole",
  tags: ["organizations"],
  request: {
    params: z.object({ org: z.string(), username: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: OrganizationPersonRoleRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The organization's people and groups, after the change",
      content: {
        "application/json": { schema: OrganizationPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/orgs/{org}/people/{username}",
  operationId: "removeOrganizationPerson",
  tags: ["organizations"],
  request: {
    params: z.object({ org: z.string(), username: z.string() }),
  },
  responses: {
    200: {
      description: "The organization's people and groups, after the change",
      content: {
        "application/json": { schema: OrganizationPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/orgs/{org}/groups",
  operationId: "createOrganizationGroup",
  tags: ["organizations"],
  request: {
    params: z.object({ org: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: CreateOrganizationGroupRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "The group, granted onto nothing yet",
      content: {
        "application/json": {
          schema: CreatedOrganizationGroupPayloadSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/orgs/{org}/groups/{group}/members",
  operationId: "addOrganizationGroupMember",
  tags: ["organizations"],
  request: {
    params: z.object({ org: z.string(), group: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: OrganizationGroupMemberRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The organization's people and groups, after the change",
      content: {
        "application/json": { schema: OrganizationPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/orgs/{org}/groups/{group}/members/{username}",
  operationId: "removeOrganizationGroupMember",
  tags: ["organizations"],
  request: {
    params: z.object({
      org: z.string(),
      group: z.string(),
      username: z.string(),
    }),
  },
  responses: {
    200: {
      description: "The organization's people and groups, after the change",
      content: {
        "application/json": { schema: OrganizationPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/visibility",
  operationId: "setBinderVisibility",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: BinderVisibilityRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The binder's people, after the change",
      content: {
        "application/json": { schema: BinderPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/people",
  operationId: "getBinderPeople",
  tags: ["workspaces"],
  request: { params: z.object({ org: z.string(), binder: z.string() }) },
  responses: {
    200: {
      description: "Who can act in this binder, one row per person",
      content: {
        "application/json": { schema: BinderPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/people",
  operationId: "addBinderPerson",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: BinderPersonRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The binder's people, after the change",
      content: {
        "application/json": { schema: BinderPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/people/{username}",
  operationId: "setBinderPersonLevel",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      username: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": { schema: BinderPersonRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The binder's people, after the change",
      content: {
        "application/json": { schema: BinderPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/binders/{org}/{binder}/people/{username}",
  operationId: "removeBinderPerson",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      username: z.string(),
    }),
  },
  responses: {
    200: {
      description: "The binder's people, after the change",
      content: {
        "application/json": { schema: BinderPeoplePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/groups",
  operationId: "grantBinderGroup",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: BinderGroupRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The teams granted here, and the approvals whitelist",
      content: {
        "application/json": { schema: BinderGroupsPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/binders/{org}/{binder}/groups/{group}",
  operationId: "revokeBinderGroup",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      group: z.string(),
    }),
  },
  responses: {
    200: {
      description: "The teams granted here, and the approvals whitelist",
      content: {
        "application/json": { schema: BinderGroupsPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/settings",
  operationId: "getBinderSettings",
  tags: ["workspaces"],
  request: { params: z.object({ org: z.string(), binder: z.string() }) },
  responses: {
    200: {
      description: "Who can act in this binder, and the rules it is under",
      content: {
        "application/json": { schema: WorkspaceSettingsPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/app/binders/{org}/{binder}/rules",
  operationId: "setBinderRules",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: BinderRulesRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "The binder's rules, after the change. Immediate",
      content: {
        "application/json": { schema: BinderRulesPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/rules/sign-off",
  operationId: "proposeBinderSignOffRules",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: SignOffRulesRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description:
        "The change that would apply these rules. Nothing has taken effect yet",
      content: {
        "application/json": { schema: ProposedSignOffChangeSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/history",
  operationId: "getBinderHistory",
  tags: ["workspaces"],
  request: { params: z.object({ org: z.string(), binder: z.string() }) },
  responses: {
    200: {
      description: "Every version this binder has published, newest first",
      content: {
        "application/json": { schema: WorkspaceHistoryPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/documents",
  operationId: "listBinderDocuments",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    /**
     * Read the binder as it stands in your own draft, rather than on `main`.
     *
     * Edit mode has to see what it has just done — a folder made a second ago
     * is not on `main` and never will be until the change request publishes.
     * Your own draft only; naming somebody else's is refused.
     */
    query: z.object({
      draft: z.string().optional(),
      /**
       * Read the binder as a change request would leave it.
       *
       * A document read on a change's branch puts the binder's contents in
       * the navigation beside it, and a tree pinned to `main` there would
       * list a policy under the name the change renamed it away from — and
       * lead to an address that does not exist on the branch being read.
       */
      change: z.string().optional(),
      /**
       * Read the binder at a branch, named — `/-/tree/{ref}` in the app.
       *
       * Somebody else's unproposed draft is refused, as it is for a document
       * read at a ref.
       */
      ref: z.string().optional(),
    }),
  },
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
    /**
     * Read it in your own draft rather than on `main`.
     *
     * A policy renamed while editing is at that name on the draft branch and
     * nowhere else, so opening it from the tree in edit mode asked `main` for
     * an address `main` has never heard of — and was told, of a document
     * sitting on screen, that it does not exist. Your own draft only.
     */
    query: z.object({
      draft: z.string().optional(),
      /**
       * Read it on a change request's branch.
       *
       * **A change request is a branch, and a document on it has an address.**
       * The proposed version used to be readable only inside the change's own
       * page, in a panel beside the discussion — half a column wide, headed by
       * the change's title rather than the document's, at a URL that said
       * nothing about which document it was. This is the binder at another
       * ref, which is what every other git front end does.
       */
      change: z.string().optional(),
      /**
       * Read it on a branch, named.
       *
       * **A file lives on a branch, and that is the address it should have.**
       * A change request is one thing that happens to a branch; the branch is
       * the thing the file is on, which is why every code host addresses a
       * file by ref rather than by pull request.
       *
       * Somebody else's draft is refused: Gitea lets every collaborator read
       * every branch, and the product's rule is narrower — other people's
       * drafts are visible as existing and never as contents.
       */
      ref: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description:
        "One document, with its published versions — on the record, in your draft, or on a change's branch",
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
            /**
             * An open change request to put this in, instead of opening one.
             *
             * The change is the unit of approval (ADR 0004 §4), so several
             * policies filed together can be approved and published together.
             */
            changeNumber: z.string().optional(),
            /**
             * Put this in a draft instead: `true` for the one you are working
             * in, or a draft's branch name.
             *
             * A multipart field is always a string, so `"true"` is what the
             * boolean looks like on the way in.
             */
            draft: z.string().optional(),
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

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/document-revisions",
  operationId: "reviseBinderDocument",
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
            /**
             * The document to revise, by its address — `nursing/hand-hygiene`.
             *
             * In the body rather than the path: a path suffix would collide
             * with a policy filed in a folder of that name.
             */
            documentPath: z.string(),
            /** An open change request to put this in, instead of opening one. */
            changeNumber: z.string().optional(),
            /**
             * Put this in a draft instead: `true` for the one you are working
             * in, or a draft's branch name.
             *
             * A multipart field is always a string, so `"true"` is what the
             * boolean looks like on the way in.
             */
            draft: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The new file's path, and the change that would publish it",
      content: {
        "application/json": {
          schema: CreatedWorkspaceDocumentPayloadSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/folders",
  operationId: "createBinderFolder",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** Nests as deep as wanted — `clinical/nursing/ward-3`. */
            folder: z.string(),
            /** An open change request to put it in, instead of opening one. */
            changeNumber: z.number().optional(),
            /**
             * Put this in a draft instead: `true` for the one you are working
             * in, or a draft's branch name. Nothing is proposed to anybody
             * until the draft is.
             */
            draft: z.union([z.boolean(), z.string()]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The change request that would add the folder",
      content: {
        "application/json": { schema: BinderShapeChangePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/folder-renames",
  operationId: "renameBinderFolder",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            from: z.string(),
            /** A new name, or a path — renaming and moving are one act. */
            to: z.string(),
            changeNumber: z.number().optional(),
            /**
             * Put this in a draft instead: `true` for the one you are working
             * in, or a draft's branch name. Nothing is proposed to anybody
             * until the draft is.
             */
            draft: z.union([z.boolean(), z.string()]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The change request that would rename the folder",
      content: {
        "application/json": { schema: BinderShapeChangePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/document-renames",
  operationId: "renameBinderDocument",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** The document, by its address. */
            documentPath: z.string(),
            /** A new title, or absent to keep the one it has. */
            name: z.string().optional(),
            /** A new folder, or absent to leave it where it is. "" is the root. */
            folder: z.string().optional(),
            changeNumber: z.number().optional(),
            /**
             * Put this in a draft instead: `true` for the one you are working
             * in, or a draft's branch name. Nothing is proposed to anybody
             * until the draft is.
             */
            draft: z.union([z.boolean(), z.string()]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The change request that would rename the document",
      content: {
        "application/json": { schema: BinderShapeChangePayloadSchema },
      },
    },
  },
});

/**
 * A draft is a branch with commits and no change request — work in progress
 * that has been proposed to nobody. **Several per person**, because two
 * unrelated reorganisations should not have to be proposed in one change
 * request, and approved or refused together, just because the same person did
 * both. This was one per person, on the reasoning that "resume where I was"
 * should have a single answer; the customer asked for more and the reason is
 * about the record rather than about convenience.
 *
 * So which draft a verb acts on is something the caller says: `?draft=` on the
 * reads and the discard, `draft` in the body on the writes. Unsaid still means
 * the newest, which is what these routes did when there was only ever one.
 *
 * The branch stays out of the path — it carries slashes, and it is the
 * server's to name. Whichever way it arrives it is checked against Gitea
 * before anything happens: a draft that is not yours is refused, never served.
 */
registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/draft",
  operationId: "getBinderDraft",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    /**
     * Which of your drafts you are in. The newest when unsaid.
     *
     * A read, so a branch that is not yours — or that has been proposed since
     * the link was made — falls back rather than failing. Landing somebody in
     * their most recent work beats an error about a branch name they never
     * typed.
     */
    query: z.object({ draft: z.string().optional() }),
  },
  responses: {
    200: {
      description:
        "The draft you are in and what is in it, every draft of yours, and who else is editing. `draft` is null when you are not.",
      content: {
        "application/json": { schema: BinderDraftPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/draft",
  operationId: "openBinderDraft",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: z.object({
            /**
             * Start **another** draft, called this.
             *
             * Its presence is what distinguishes the two acts on this route.
             * Without it this is a press of Edit, which resumes your most
             * recent draft rather than forking it — accidental forks are the
             * mistake the one-draft rule existed to prevent, and still are.
             */
            name: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description:
        "Editing started, resumed, or a second draft begun — a press of Edit resumes, a name forks deliberately",
      content: {
        "application/json": { schema: BinderDraftPayloadSchema },
      },
    },
  },
});

/**
 * Call a draft something else.
 *
 * The name is how a person tells three drafts apart, and the first name
 * somebody types is rarely the one that describes what the work turned into.
 */
registry.registerPath({
  method: "patch",
  path: "/api/app/binders/{org}/{binder}/draft",
  operationId: "renameBinderDraft",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ draft: z.string(), name: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Your drafts, with that one renamed",
      content: {
        "application/json": { schema: BinderDraftPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/app/binders/{org}/{binder}/draft",
  operationId: "discardBinderDraft",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    /** Which one to throw away. The newest when unsaid. */
    query: z.object({ draft: z.string().optional() }),
  },
  responses: {
    200: {
      description: "The draft branch that was thrown away",
      content: {
        "application/json": {
          schema: z.object({ discarded: z.string() }),
        },
      },
    },
  },
});

/**
 * Propose your draft: open the change request, with the title you wrote.
 *
 * The title is the author's, not the server's. A change request is a request —
 * it is addressed to colleagues, and the sentence explaining it should be the
 * words of the person asking. The body's first line is the title and the rest
 * is the description, which is the convention every change in the product
 * already follows.
 */
registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/changes",
  operationId: "proposeBinderDraft",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            description: z.string().optional(),
            /** Which draft to propose. The newest when unsaid. */
            draft: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The change request the draft is now waiting in",
      content: {
        "application/json": { schema: ProposedDraftPayloadSchema },
      },
    },
  },
});

/**
 * Take a document off the record.
 *
 * **"Archive", not "delete", and the word is the customer's** — and it is also
 * the accurate one. The file leaves `main`; every version tag still points at
 * the commit that held it, and git never collects a commit reachable from a
 * ref, so the bytes stay readable from a bare clone at every version the
 * policy reached. Nothing is destroyed.
 */
registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/document-archives",
  operationId: "archiveBinderDocument",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** The document, by its address. */
            documentPath: z.string(),
            changeNumber: z.number().optional(),
            /**
             * Put this in a draft instead: `true` for the one you are working
             * in, or a draft's branch name.
             */
            draft: z.union([z.boolean(), z.string()]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The change request that would archive it",
      content: {
        "application/json": { schema: BinderShapeChangePayloadSchema },
      },
    },
  },
});

/**
 * Bring an archived policy back.
 *
 * **An ordinary change, and deliberately not an undo.** The file is written
 * back out of the bytes its last version tag still points at, and it goes
 * through review like anything else that changes what is in force — a policy
 * quietly reappearing on the record is the thing every other act here refuses
 * to do.
 *
 * It keeps its identity, so it returns as v(N+1) rather than as a new document
 * at v1. That is honest: it is the same policy, and its history is unbroken
 * across the gap.
 */
registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/document-restores",
  operationId: "restoreBinderDocument",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /**
             * The policy's identity, which is what the archive lists it by.
             *
             * Not a path: an archived document has no path on `main`, and the
             * one it had may since have been taken by something else.
             */
            uid: z.string(),
            changeNumber: z.number().optional(),
            draft: z.union([z.boolean(), z.string()]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "The change request that would bring it back",
      content: {
        "application/json": { schema: BinderShapeChangePayloadSchema },
      },
    },
  },
});

/**
 * Give a binder a new name.
 *
 * **Renaming one changes every URL that points at it**, because a binder is a
 * Gitea repository and its name is the repository's. Gitea answers `301` from
 * the old name, so a colleague's bookmark still resolves — which is what makes
 * this safe to offer rather than a thing to warn people away from.
 *
 * Its own path rather than part of the settings, because it is not a setting:
 * every other write under `settings` leaves the address alone and this one
 * does not.
 */
/**
 * Say what a binder is for.
 *
 * A setting rather than an address, so unlike renaming it moves nothing: the
 * repository's description, written straight to Gitea.
 */
registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/description",
  operationId: "describeBinder",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** What the binder is for. Empty clears it. */
            description: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The description the binder has now",
      content: {
        "application/json": {
          schema: z.object({ description: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/name",
  operationId: "renameBinder",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** What to call it. Slugged by the same rule a new binder is. */
            name: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Its new address, and the one it answered to before",
      content: {
        "application/json": {
          schema: z.object({
            organization: z.string(),
            workspace: z.string(),
            previous: z.string(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/archive",
  operationId: "getBinderArchive",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    /**
     * Take the difference against your own draft rather than against `main`.
     *
     * A policy archived while editing is off the draft's tree and still on
     * `main` — and will be until the change request publishes. Without this
     * the binder counted the archive from the draft and then listed it from
     * `main`, so the tree said "Archived · 1 policy" and opening it showed
     * nothing. Your own draft only; naming somebody else's is refused.
     */
    query: z.object({ draft: z.string().optional() }),
  },
  responses: {
    200: {
      description:
        "Everything this binder has taken off the record — every UID with a version tag, minus every UID on the tree being read",
      content: {
        "application/json": { schema: BinderArchivePayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}",
  operationId: "getBinderChange",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      changeNumber: z.string(),
    }),
  },
  responses: {
    200: {
      description: "One change, and the documents publishing it would version",
      content: {
        "application/json": { schema: WorkspaceChangeDetailPayloadSchema },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/reviews",
  operationId: "reviewBinderChange",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      changeNumber: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
            /** Required for everything but an approval. */
            body: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The review, as Gitea recorded it",
      content: {
        "application/json": { schema: z.object({ review: z.unknown() }) },
      },
    },
  },
});

/**
 * Rewrite what a change is asking for.
 *
 * Its author's, and only while it is open: once it is published the title is
 * on the merge commit and in the version tag, which are the record.
 */
registry.registerPath({
  method: "patch",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}",
  operationId: "editBinderChange",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      changeNumber: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            /** What they are asking for, and why. Empty clears it. */
            body: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The change, as it now reads",
      content: {
        "application/json": {
          schema: z.object({ title: z.string(), body: z.string() }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/update",
  operationId: "updateBinderChange",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      changeNumber: z.string(),
    }),
  },
  responses: {
    200: {
      description: "The change's branch now carries the binder's main",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            /** False while Gitea is still recomputing the merge base. */
            caughtUp: z.boolean(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/publish",
  operationId: "publishBinderChange",
  tags: ["workspaces"],
  request: {
    params: z.object({
      org: z.string(),
      binder: z.string(),
      changeNumber: z.string(),
    }),
  },
  responses: {
    200: {
      description: "A version tag for every document the change touched",
      content: {
        "application/json": {
          schema: PublishedWorkspaceChangePayloadSchema,
        },
      },
    },
  },
});

/**
 * The binder's own address for the same six operations.
 *
 * A binder is a Gitea repository and a change on it is a Gitea pull request,
 * so every one of these is the document model's handler reached at the
 * binder's address — same behaviour, one namespace per shape of thing, not a
 * second implementation.
 */
const binderChangeParams = z.object({
  org: z.string(),
  binder: z.string(),
  changeNumber: z.string(),
});

const binderThreadParams = binderChangeParams.extend({
  threadId: z.string(),
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/discussions",
  operationId: "listBinderChangeDiscussions",
  tags: ["workspaces"],
  request: { params: binderChangeParams },
  responses: {
    200: {
      description: "Review discussion threads",
      content: { "application/json": { schema: DiscussionSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/discussions",
  operationId: "createBinderChangeDiscussion",
  tags: ["workspaces"],
  request: {
    params: binderChangeParams,
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
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/discussions/{threadId}/comments",
  operationId: "replyToBinderChangeDiscussion",
  tags: ["workspaces"],
  request: {
    params: binderThreadParams,
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
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/discussions/{threadId}/resolve",
  operationId: "resolveBinderChangeDiscussion",
  tags: ["workspaces"],
  request: {
    params: binderThreadParams,
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
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/discussions/{threadId}/comments/{commentId}/reactions",
  operationId: "setBinderDiscussionCommentReaction",
  tags: ["workspaces"],
  request: {
    params: binderThreadParams.extend({ commentId: z.string() }),
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
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/updates",
  operationId: "listBinderChangeUpdates",
  tags: ["workspaces"],
  request: { params: binderChangeParams },
  responses: {
    200: {
      description: "Every update this change has proposed, oldest first",
      content: { "application/json": { schema: ChangeUpdatesPayloadSchema } },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/app/binders/{org}/{binder}/changes/{changeNumber}/assignments",
  operationId: "updateBinderChangeAssignments",
  tags: ["workspaces"],
  request: {
    params: binderChangeParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateChangeAssignmentsBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Who is on the hook for this change",
      content: { "application/json": { schema: ChangeAssignmentsSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/app/binders/{org}/{binder}/collaborators",
  operationId: "listBinderCollaborators",
  tags: ["workspaces"],
  request: {
    params: z.object({ org: z.string(), binder: z.string() }),
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Everyone who can act in this binder",
      content: {
        "application/json": { schema: CollaboratorListPayloadSchema },
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
  request: {
    query: z.object({
      /** Which of this person's organizations; their oldest when omitted. */
      organization: z.string().optional(),
    }),
  },
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
