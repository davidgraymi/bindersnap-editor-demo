import {
  LoginBodySchema,
  SignupBodySchema,
} from "../../packages/api-schema/schemas/auth";
import {
  SubmitReviewBodySchema,
  PublishDocumentBodySchema,
  UpdatePermissionsBodySchema,
  AddCollaboratorBodySchema,
} from "../../packages/api-schema/schemas/documents";
import { BillingActionBodySchema } from "../../packages/api-schema/schemas/billing";
import { SetAdminAccessBodySchema } from "../../packages/api-schema/schemas/admin";

export function parseLoginBody(payload: unknown) {
  return LoginBodySchema.parse(payload);
}

export function parseSignupBody(payload: unknown) {
  return SignupBodySchema.parse(payload);
}

export function parseSubmitReviewBody(payload: unknown) {
  return SubmitReviewBodySchema.parse(payload);
}

export function parsePublishDocumentBody(payload: unknown) {
  return PublishDocumentBodySchema.parse(payload);
}

export function parseUpdatePermissionsBody(payload: unknown) {
  return UpdatePermissionsBodySchema.parse(payload);
}

export function parseAddCollaboratorBody(payload: unknown) {
  return AddCollaboratorBodySchema.parse(payload);
}

export function parseBillingActionBody(payload: unknown) {
  return BillingActionBodySchema.parse(payload);
}

export function parseSetAdminAccessBody(payload: unknown) {
  return SetAdminAccessBodySchema.parse(payload);
}
