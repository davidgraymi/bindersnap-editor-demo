/**
 * The public site's pages a reader can ask to be emailed ("Email it to me"),
 * each with the name the email calls it by.
 *
 * The form is posted to the API by anyone, with no session, so the API sends
 * nothing it builds from the request: the page asked for must be one of
 * these, and the email's subject, heading and links come from this list.
 * Shared because the site draws the form and the API answers it, and neither
 * imports the other. A site test holds the list equal to the pages that offer
 * the form, with their titles, so a new template cannot ship without a line
 * here.
 */
export const SITE_RESOURCES: Readonly<Record<string, string>> = {
  "/templates/controlled-drug-disposal-policy":
    "Hospice controlled drug disposal policy template",
  "/templates/emergency-preparedness-policy":
    "Emergency preparedness policy template (CMS rule)",
  "/templates/exposure-control-plan": "OSHA exposure control plan template",
  "/templates/hand-hygiene-policy":
    "Hand hygiene policy template for healthcare settings",
  "/templates/patient-grievance-policy": "Patient grievance policy template",
  "/templates/policy-review-and-approval":
    "Policy on policies template: review and approval",
  "/manuals/asc-policy-and-procedure-manual":
    "Surgery center (ASC) policy and procedure manual index",
  "/manuals/home-health-policy-and-procedure-manual":
    "Home health policy and procedure manual index",
  "/manuals/hospice-policy-and-procedure-manual":
    "Hospice policy and procedure manual index",
  "/manuals/rural-health-clinic-policy-and-procedure-manual":
    "Rural health clinic policy and procedure manual index",
  "/tools/required-policies-checklist":
    "Required healthcare policies checklist (free tool)",
};

export function isSiteResource(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(SITE_RESOURCES, value);
}
