# Data Processing Addendum

Last updated: October 9, 2026
Version: 2026-10-09

This Data Processing Addendum ("DPA") is part of the Terms of Service (the "Terms") between Solid Gray LLC, a [STATE] limited liability company that operates Bindersnap ("Bindersnap," "we"), and the Customer. It applies when we process Personal Data on the Customer's behalf through the Service.

The Customer accepts this DPA by accepting the Terms. No separate signature is needed. The Customer can request a countersigned copy at [privacy@bindersnap.com](mailto:privacy@bindersnap.com).

## 1. Definitions

- **Applicable Data Protection Law** means the laws that apply to our processing of Customer Personal Data, including, as applicable, the EU General Data Protection Regulation (GDPR), the UK GDPR and Data Protection Act 2018, the Swiss FADP, and U.S. state privacy laws such as the California Consumer Privacy Act as amended (CCPA).
- **Customer Personal Data** means Personal Data contained in Customer Content, including the invitations, team membership and binder roles the Customer manages. It does not include account, billing, security, log, email-sending and agreement records, for which we are an independent controller under our Privacy Policy.
- **Controller, Processor, Data Subject, Personal Data, Personal Data Breach, Processing,** and **Supervisory Authority** have the meanings in the GDPR. "Business," "Service Provider," "Sell," and "Share" have the meanings in the CCPA.
- **Subprocessor** means a third party we engage that processes Customer Personal Data.
- **Terms such as "Customer Content," "Service"** have the meanings in the Terms.

## 2. Roles and scope

The Customer is the Controller (or a Processor acting for its own controller) and we are the Processor (or Subprocessor) of Customer Personal Data. Under the CCPA, the Customer is the Business and we are its Service Provider.

We act as an independent controller for the data we use for our own purposes: user accounts, billing records, account security and server logs, records of the emails we send, records of agreement to the Terms, and preventing trial abuse. Our Privacy Policy at [/legal/privacy](/legal/privacy) covers that use, and this DPA does not.

Annex 1 describes the processing. The Customer must not submit protected health information (PHI) or other special-category data to the Service, as stated in Section 5 of the Terms. Annex 1 reflects that restriction. If such data is submitted, the Customer instructs us to restrict or permanently remove it as Section 5 of the Terms allows.

## 3. Processing on instructions

We will process Customer Personal Data only on the Customer's documented instructions. The Terms, this DPA, and the Customer's use of the Service's features are the Customer's complete instructions. Further instructions must be reasonable, consistent with the Service, and agreed in writing.

We will tell the Customer if we think an instruction violates Applicable Data Protection Law. We may process Customer Personal Data without instructions where law requires, and we will tell the Customer first unless the law forbids it.

The Customer is responsible for having a lawful basis for the processing, giving notices to Data Subjects, and making sure its use of the Service complies with law.

## 4. Confidentiality of personnel

We will make sure that people authorized to process Customer Personal Data are bound by confidentiality obligations, and that they access it only as needed to provide, secure, and support the Service.

## 5. Security

We will implement appropriate technical and organizational measures to protect Customer Personal Data against accidental or unlawful destruction, loss, alteration, unauthorized disclosure, or access, taking into account the risk. Our current measures are summarized in Annex 2 and described at [/legal/security](/legal/security).

We may update our measures over time, but we will not materially lower the overall level of protection. We do not hold SOC 2, ISO 27001, HITRUST, or similar certifications, and we do not claim them.

The Customer is responsible for its own security choices, including strong passwords, assigning roles, removing people who no longer need access, and keeping its own devices secure.

## 6. Subprocessors

**Authorization.** The Customer gives general written authorization for us to use the Subprocessors listed at [/legal/subprocessors](/legal/subprocessors) and in Annex 3.

**Our obligations.** We will:

- have a written agreement with each Subprocessor that requires data protection obligations no less protective than this DPA, to the extent relevant to the services the Subprocessor provides, and
- remain responsible for each Subprocessor's performance of those obligations.

**Changes.** We will give at least 30 days' notice before adding or replacing a Subprocessor that will process Customer Personal Data. We will update the subprocessors page and email the organization's owners.

**Right to object.** The Customer may object to a new Subprocessor on reasonable data protection grounds by emailing [privacy@bindersnap.com](mailto:privacy@bindersnap.com) within 30 days after our notice. We will discuss the objection in good faith and try to offer a workable alternative. If we cannot resolve it within a reasonable time, the Customer may cancel the affected Service by notice, and we will refund prepaid fees for the period after cancellation. We may replace a Subprocessor sooner where needed for security or to avoid disruption, and we will notify the Customer as soon as possible.

## 7. Assistance with Data Subject requests

Taking into account the nature of the processing, we will help the Customer respond to requests from Data Subjects to exercise their rights (access, correction, deletion, restriction, portability, objection, and similar rights), using appropriate technical and organizational measures. Many of these tasks the Customer can do itself through the Service, including exporting documents and deleting accounts, binders, and organizations.

If a Data Subject contacts us directly about Customer Personal Data, we will direct them to the Customer and will not respond on the substance unless the Customer instructs us or law requires. We may charge a reasonable fee for assistance that requires disproportionate effort, after telling the Customer.

## 8. Personal Data Breach

We will notify the Customer without undue delay after we confirm a Personal Data Breach affecting Customer Personal Data, and in any event within 72 hours of confirmation. We will send notice to the organization's owners by email.

The notice will describe, to the extent known:

- the nature of the breach, including the categories and approximate number of Data Subjects and records affected;
- the likely consequences;
- the measures we have taken or propose to take; and
- a contact point for more information.

We may provide information in phases as we learn it. We will take reasonable steps to contain and investigate the breach, and will cooperate with the Customer so that it can meet its own notification duties. Our notice is not an admission of fault. This section does not apply to incidents caused by the Customer or its users, such as compromised credentials that the Customer failed to protect, although we will still help where we reasonably can.

## 9. Data protection assessments

Taking into account the nature of the processing and the information we have, we will give the Customer reasonable help with data protection impact assessments and prior consultations with Supervisory Authorities, relating to the Customer's use of the Service. We may do so by pointing to our documentation.

## 10. Retention and deletion

This section describes how data leaves the Service. It matches how the Service works today.

**10.1 Account deletion.** A person can delete their own account in settings.

- Gitea deletes the account.
- Everything in the record that refers to the person, including reviews, comments, and published versions, stays on the record, because it is the organization's evidence.
- Their drafts that were never proposed are retired: they are moved out of the draft area so nobody can pick them up.
- Their sessions are revoked, and their email-verification record is removed.
- An account cannot be deleted while the person is the sole owner of an organization.

**10.2 Binder deletion.** Only organization owners can delete a binder, and they must type the binder's name to confirm.

- The whole repository is deleted for good: every version, approval, and discussion.
- The Service offers each document's audit packet (an export) first. The Customer should export before deleting.
- An append-only settings-history entry remains, noting that the binder was deleted.
- Deletion cannot be undone.

**10.3 Organization deletion.** Only owners can delete an organization, and only once it has no binders and no subscription that is still charging.

- Deletion removes its people, groups, and name.
- We keep a minimal record, renamed "[name] (deleted)", so a free trial cannot be restarted by deleting and recreating an organization.

**10.4 Backups.** After deletion, copies stay in backups until they age out:

- hourly disk snapshots: up to 2 days;
- daily disk snapshots, including their copy in a second AWS region: up to 35 days;
- versions in our private backup storage (S3): up to 30 days;
- encrypted off-site backups (Cloudflare R2): up to 45 days; and
- application logs (CloudWatch): 30 days.

We do not restore deleted data from backups to the live Service for the purpose of re-processing it, except to recover from a disaster, and we will delete again anything that was deleted before the restore.

**10.5 Return of data.** The Customer can export its data at any time using the Service's exports: each document's audit packet and PDF or Word downloads. Exports remain available under the conditions in Section 10 of the Terms, and for at least 30 days after the agreement ends (Section 14 of the Terms).

**10.6 End of the agreement.** After the agreement ends and the export period passes, we will delete Customer Personal Data in the live Service, and it will age out of backups as stated in 10.4, unless law requires us to keep it. If law requires retention, we will keep it protected and process it only as the law requires.

**10.7 Our own records.** Billing records, the record of who agreed to which version of the Terms and when (kept for six years after the account is deleted), and the minimal record in 10.3, are kept for the purposes in our Privacy Policy, such as tax, accounting, and fraud prevention.

## 11. Audits and information

We will give the Customer the information reasonably needed to show that we comply with this DPA, and we will allow and contribute to audits as follows.

- **First step: documents.** We will answer reasonable security and privacy questionnaires and make available our written policies and relevant documentation, including [/legal/security](/legal/security). We will not provide documents that would compromise the security of other customers.
- **Further audit.** If that information is not enough to show compliance, or a Supervisory Authority requires it, the Customer may audit us. It must:
- give at least 30 days' written notice;
- agree on scope, timing, and a confidentiality undertaking in advance;
- audit no more than once in any 12 months, except after a Personal Data Breach or as required by law; and
- avoid unreasonable disruption.
- **Costs.** The Customer bears its own costs and ours for time beyond a reasonable amount.
- We may satisfy the right by having a qualified independent party audit and giving the Customer the report. We do not hold third-party certifications, and nothing in this DPA requires us to obtain one. Our Subprocessors are audited through the reports and certifications they publish.

## 12. International transfers

**Hosting location.** The Service is offered to organizations based in the United States. We host Customer Personal Data in the United States, in AWS region us-east-1 (N. Virginia). Our Subprocessors are in the United States.

**EU, UK, and Swiss data.** The Service is not offered to organizations outside the United States. Even so, a Customer may hold Personal Data of people in Europe, such as staff working abroad. If the Customer sends us Personal Data subject to the GDPR, the UK GDPR, or the Swiss FADP, which we process in the United States, the following apply:

- **EU Standard Contractual Clauses.** The parties agree to the EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914), which are incorporated by reference and completed as follows:
- Module Two (controller to processor) applies where the Customer is a controller. Module Three (processor to processor) applies where the Customer is a processor.
- Clause 7 (docking clause) applies.
- In Clause 9(a), Option 2 (general written authorization) applies, with the notice period in Section 6 above.
- In Clause 11, the optional independent dispute-resolution language does not apply.
- In Clause 17, Option 1 applies. The governing law is the law of Ireland.
- In Clause 18, the courts of Ireland resolve disputes.
- Annex I is Annex 1 of this DPA, with the Customer as "data exporter" and Bindersnap as "data importer." The competent Supervisory Authority is the one that applies to the Customer under Clause 13.
- Annex II is Annex 2 of this DPA. Annex III is Annex 3.
- **UK.** For transfers from the UK, the UK International Data Transfer Addendum to the EU SCCs, issued by the UK Information Commissioner under section 119A of the Data Protection Act 2018 (version B1.0), is incorporated by reference. Its tables are completed with the information in this DPA, and neither party may end the Addendum under its Section 19 except as that Section permits.
- **Switzerland.** For transfers from Switzerland, the SCCs apply with references to the GDPR read as references to the FADP, and with the Swiss Federal Data Protection and Information Commissioner as the competent authority.
- **Priority.** If this DPA conflicts with the SCCs, the SCCs control.

**Data Privacy Framework.** We have not self-certified to the EU-U.S. Data Privacy Framework. We rely on the SCCs. If we later certify, we will tell the Customer, and the Framework may also serve as a transfer basis.

**Government requests.** If we receive a legally binding request from a public authority for Customer Personal Data, we will, where the law allows, notify the Customer, challenge the request if we have reasonable grounds to think it is unlawful, and disclose only the minimum required.

## 13. CCPA and U.S. state privacy laws

To the extent the CCPA or another U.S. state privacy law applies, we make these commitments as the Customer's Service Provider (or "processor" under state laws that use that term):

- We process Customer Personal Data only for the limited and specified business purposes of providing the Service, as described in the Terms, this DPA, and Annex 1.
- We will not Sell or Share Customer Personal Data.
- We will not retain, use, or disclose Customer Personal Data for any purpose other than those business purposes, or outside the direct business relationship with the Customer, except as the law allows.
- We will not combine Customer Personal Data with Personal Data that we receive from other sources or collect from our own interactions with individuals, except as the law allows for a Service Provider.
- We will comply with the law that applies to us and provide the same level of privacy protection that the law requires of the Customer.
- The Customer may take reasonable and appropriate steps to make sure we use Customer Personal Data consistently with its obligations, including through Section 11.
- We will tell the Customer if we determine that we can no longer meet our obligations under the law. The Customer may then take reasonable steps to stop and remediate unauthorized use, including by suspending the transfer of Customer Personal Data to us.
- The Customer discloses Customer Personal Data to us only for these limited and specified purposes.
- Our Subprocessors are bound by written contracts as required by Section 6.

We certify that we understand and will comply with these restrictions.

## 14. Liability

Each party's liability under this DPA is subject to the limitations and exclusions of liability in the Terms. Nothing limits liability that cannot be limited by law, or any Data Subject's rights under the SCCs.

## 15. Term and order of precedence

This DPA starts when the Customer accepts the Terms and lasts as long as we process Customer Personal Data. Sections that by nature continue (including Sections 10 and 14) continue after that.

If this DPA conflicts with the Terms on the processing of Personal Data, this DPA controls. If it conflicts with the SCCs, the SCCs control.

## 16. Changes

We may update this DPA as described in Section 18 of the Terms, for example to reflect new law or updated transfer mechanisms. We will not make a change that materially reduces the protections for Customer Personal Data without the notice that Section 18 requires. If a change is required by a regulator or a court, it may take effect as soon as needed.

## 17. Contact

Privacy questions, countersigned copies, objections, and Data Subject requests: [privacy@bindersnap.com](mailto:privacy@bindersnap.com). Security reports: [security@bindersnap.com](mailto:security@bindersnap.com). Our mailing address is [MAILING ADDRESS].

---

## Annex 1: Description of processing

**Parties.**

- Data exporter (Controller): the Customer, as identified by its account and by the person who accepted the Terms for it.
- Data importer (Processor): Solid Gray LLC, operating Bindersnap, [privacy@bindersnap.com](mailto:privacy@bindersnap.com).

**Subject matter.** Providing the Bindersnap document authoring, review, approval, publishing, and record-keeping service.

**Duration.** For as long as the Customer has an account, plus the export period and the deletion and backup ageing described in Section 10.

**Nature of the processing.** Hosting, storage, retrieval, display, transmission, backup, and deletion of Customer Content; sending the invitation and notification emails that the Customer's use of the Service triggers; supporting and securing the Service.

**Purpose.** To provide the Service to the Customer under the Terms, to secure it, to support the Customer, and to comply with law.

**Frequency of transfer.** Continuous, for as long as the Customer uses the Service.

**Categories of Data Subjects.**

- the Customer's authorized users (employees, contractors, board members, and others it invites);
- individuals named in documents and comments, such as authors, approvers, and reviewers; and
- people the Customer invites by email, before they join.

**Categories of Personal Data.**

- Identity in the record: the names and usernames of the Customer's users as they appear on versions, approvals, reviews and comments, and the identity of who did what and when.
- Membership: the Customer's teams, who is in them, and each person's role in each binder.
- Content data: names and other Personal Data that users put in documents, versions, approvals, review comments, reactions, and tags.
- Invitations: the email addresses the Customer invites, and the invitation emails the Service sends to them.

**Special categories of data.** None. The Customer must not submit special-category data (as defined in GDPR Article 9), protected health information (PHI) under HIPAA, or data about criminal convictions, as set out in Section 5 of the Terms. We do not sign business associate agreements.

**Retention.** As described in Section 10.

**Subprocessor transfers.** Subprocessors process data for the same subject matter and duration as above, for the services listed in Annex 3.

## Annex 2: Security measures

Our measures are described in full at [/legal/security](/legal/security). In summary:

- **Hosting.** A single AWS host in us-east-1 (N. Virginia, USA), with application services running in containers.
- **Encryption.** TLS in transit. Encrypted disk volumes (AWS-managed keys) at rest. The private backup bucket blocks all public access and uses default server-side encryption.
- **Access control.** No inbound SSH. Administrator access only through AWS Systems Manager, using short-lived keys. Secrets are kept in AWS Parameter Store, not in source code. Deployments use short-lived CI credentials.
- **Application security.** Server-side sessions with an HttpOnly cookie. Service credentials stay on the server and never reach the browser. Sessions are revoked at sign-out. Passwords are hashed. Reset and verification tokens are hashed. Authentication is rate-limited. Standard security headers are set.
- **In-product controls.** Roles for administrators, authors, and reviewers. Branch protection so changes reach the published record only with the approvals the binder requires. Approved versions cannot be edited, only superseded.
- **Resilience.** Continuous database replication to a private, versioned bucket, with old versions expiring after 30 days. Daily disk snapshots, with the latest 7 kept.
- **Monitoring.** Alarms for host health, CPU, disk, and memory. Logs are kept for 30 days.
- **Certifications.** None. We do not claim SOC 2, ISO 27001, or HITRUST.

## Annex 3: Subprocessors

The current list is at [/legal/subprocessors](/legal/subprocessors). As of the date above:

| Subprocessor              | Purpose                                                                                                                                                                                 | Location                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Amazon Web Services, Inc. | Hosting, storage, and backups (EC2, EBS, S3); logs (CloudWatch); email delivery (SES)                                                                                                   | USA (us-east-1; backups also us-west-2)                          |
| Cloudflare, Inc.          | Network edge (DNS, TLS, attack protection); hosting of the website and app files; encrypted backups (R2); inbound email forwarding; the feedback service and its spam check (Turnstile) | Requests: nearest Cloudflare data center. Backups: North America |
| GitHub, Inc.              | Storing feedback and bug reports sent from the app, in a private repository                                                                                                             | USA                                                              |
| Stripe, Inc.              | Subscription billing and payments                                                                                                                                                       | USA                                                              |

Changes to this list follow Section 6.
