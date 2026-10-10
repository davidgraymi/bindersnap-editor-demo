# Subprocessors

Last updated: October 9, 2026
Version: 2026-10-09

A subprocessor is a company we use to run Bindersnap that may handle personal information on our behalf. We keep the list short and use each company only for what's listed here.

Customer Content (your organization's documents, versions, approvals, reviews, comments, reactions and tags) is stored on our servers at Amazon Web Services in the United States. Cloudflare carries it between your browser and those servers, and keeps an encrypted copy of our backups that it cannot read. Stripe never receives Customer Content. GitHub receives only the feedback you choose to send us from the app, never your documents.

## Current subprocessors

| Name                      | What they do for us                                                                                                                                                                                                                                                                                                           | Data they process                                                                                                                                                                                                                                                                                             | Location                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Amazon Web Services, Inc. | Hosts our servers, storage and backups (EC2, EBS, S3); keeps server logs (CloudWatch); delivers our email (SES)                                                                                                                                                                                                               | All Customer Content; account, billing and configuration data; server logs including usernames and IP addresses; email addresses and message contents for the emails we send                                                                                                                                  | USA (us-east-1, Northern Virginia; backup copies in us-west-2, Oregon)               |
| Cloudflare, Inc.          | Runs the network in front of our servers: DNS, the encrypted connection from your browser, protection against attacks; hosts our public website and the app's files; stores an encrypted copy of our backups (R2); forwards email sent to @bindersnap.com addresses; runs our feedback service and its spam check (Turnstile) | Customer Content and account data in transit between your browser and our servers; IP addresses and request details; backups encrypted before they leave our servers, which Cloudflare cannot read; emails sent to our addresses; feedback reports in transit, and browser details for the spam check         | Requests: the Cloudflare data center nearest the visitor. Backups: R2, North America |
| GitHub, Inc.              | Stores the feedback and bug reports you send from the app, in a private repository only our team can open                                                                                                                                                                                                                     | What you write in a report; your username and name; your organization's name; the address of the page you were on; the app's version; your browser and screen size; the method, address, status and timing of your recent requests to Bindersnap; and recent error messages. Never the text of your documents | USA                                                                                  |
| Stripe, Inc.              | Subscription billing and payments                                                                                                                                                                                                                                                                                             | Your organization's ID; the username of the person who subscribed; billing details and payment cards entered directly on Stripe's pages (Bindersnap never sees card numbers)                                                                                                                                  | USA                                                                                  |

## Other services

These companies are not subprocessors, because they never receive Customer Content or account data. We list them so you know every company your browser talks to when you use Bindersnap.

| Name       | What they do for us                                                                                                        | What they see                                                                                                                        | Location |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Google LLC | Website analytics (Google Analytics) on our public marketing pages only, such as /pricing and /templates; never in the app | IP address, browser and device details, and the pages visited, for people who read those pages. No Customer Content or account data. | USA      |

Our fonts and profile pictures come from Bindersnap itself, not from Google Fonts, Gravatar or any other outside service. Our Privacy Policy at [/legal/privacy](/legal/privacy) explains this in more detail.

## When this list changes

Before we add or replace a subprocessor, we will:

1. update this page and its "Last updated" date, and
2. email the owners of every organization at least 30 days before the new subprocessor starts handling personal information.

If your organization objects to a new subprocessor, follow the objection process in Section 6 of our Data Processing Addendum at [/legal/dpa](/legal/dpa).

## Questions

Email [privacy@bindersnap.com](mailto:privacy@bindersnap.com).
