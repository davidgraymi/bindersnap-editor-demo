/**
 * The required-policies checklist at `/tools/required-policies-checklist`:
 * the written policies, plans and programs federal rules require, filtered by
 * what describes the reader's organization.
 *
 * Every row cites the rule it comes from, checked against the eCFR text, and
 * the same rows are the page's Markdown copy, so an agent reads the whole
 * list. The page works without its script: every row shows, and the filter
 * appears only once the script has run.
 */

export interface Situation {
  key: string;
  label: string;
}

/** What a reader ticks. A row shows when any of its situations is ticked. */
export const SITUATIONS: readonly Situation[] = [
  {
    key: "asc",
    label: "We are a Medicare-certified ambulatory surgery center",
  },
  { key: "hha", label: "We are a Medicare-certified home health agency" },
  { key: "hospice", label: "We are a Medicare-certified hospice" },
  { key: "rhc", label: "We are a rural health clinic or FQHC" },
  { key: "otp", label: "We are an opioid treatment program" },
  {
    key: "part2",
    label: "We hold substance use disorder records covered by 42 CFR Part 2",
  },
  { key: "hipaa", label: "We are a HIPAA covered entity" },
  {
    key: "exposure",
    label: "Our staff could be exposed to blood or body fluids at work",
  },
  { key: "chemicals", label: "Our staff work with hazardous chemicals" },
  { key: "lab", label: "We run laboratory tests under a CLIA certificate" },
];

export interface RequiredPolicy {
  name: string;
  /** What the rule asks for, in a sentence. */
  requirement: string;
  /** How often it must be reviewed, or how long kept, where the rule says. */
  cycle: string;
  citation: string;
  url: string;
  when: readonly string[];
  /** A page on this site that helps write it. */
  help?: string;
}

const ecfr = (title: number, section: string) =>
  `https://www.ecfr.gov/current/title-${title}/section-${section}`;

export const REQUIRED_POLICIES: readonly RequiredPolicy[] = [
  {
    name: "Exposure control plan",
    requirement:
      "A written plan to eliminate or minimize employee exposure to bloodborne pathogens.",
    cycle: "Reviewed and updated at least annually",
    citation: "29 CFR 1910.1030(c)(1)",
    url: ecfr(29, "1910.1030"),
    when: ["exposure"],
    help: "/templates/exposure-control-plan",
  },
  {
    name: "Hazard communication program",
    requirement:
      "A written hazard communication program for each workplace, with a list of the hazardous chemicals present.",
    cycle: "Kept current",
    citation: "29 CFR 1910.1200(e)",
    url: ecfr(29, "1910.1200"),
    when: ["chemicals"],
  },
  {
    name: "Privacy policies and procedures",
    requirement:
      "Policies and procedures for protected health information, changed promptly when the law changes.",
    cycle: "Each version kept 6 years from creation or when last in effect",
    citation: "45 CFR 164.530(i)–(j)",
    url: ecfr(45, "164.530"),
    when: ["hipaa"],
    help: "/requirements/hipaa-policies-and-procedures",
  },
  {
    name: "Security policies and procedures",
    requirement:
      "Policies and procedures to comply with the Security Rule for electronic protected health information.",
    cycle: "Reviewed periodically; each version kept 6 years",
    citation: "45 CFR 164.316",
    url: ecfr(45, "164.316"),
    when: ["hipaa"],
    help: "/requirements/hipaa-policies-and-procedures",
  },
  {
    name: "Laboratory procedure manual",
    requirement:
      "A written procedure for every test; each procedure and change approved, signed and dated by the laboratory director before use.",
    cycle: "Approved before use; kept 2 years after discontinuance",
    citation: "42 CFR 493.1251, 493.1105(a)(2)",
    url: ecfr(42, "493.1251"),
    when: ["lab"],
    help: "/requirements/who-approves-policies",
  },
  {
    name: "Policies governing the ASC's total operation",
    requirement:
      "The governing body determines, implements and monitors the ASC's policies.",
    cycle: "Not set; your accreditor or state may set one",
    citation: "42 CFR 416.41",
    url: ecfr(42, "416.41"),
    when: ["asc"],
    help: "/templates/policy-review-and-approval",
  },
  {
    name: "Grievance procedure",
    requirement:
      "A procedure for documenting, investigating and answering patient grievances, with timeframes and a written decision.",
    cycle: "Not set",
    citation: "42 CFR 416.50(d)",
    url: ecfr(42, "416.50"),
    when: ["asc"],
    help: "/templates/patient-grievance-policy",
  },
  {
    name: "Advance directives policies",
    requirement:
      "Written information for patients on the ASC's policies on advance directives.",
    cycle: "Not set",
    citation: "42 CFR 416.50(c)",
    url: ecfr(42, "416.50"),
    when: ["asc"],
  },
  {
    name: "Infection control program",
    requirement:
      "An ongoing program to prevent, control and investigate infections, using nationally recognized guidelines.",
    cycle: "Not set",
    citation: "42 CFR 416.51",
    url: ecfr(42, "416.51"),
    when: ["asc"],
    help: "/templates/hand-hygiene-policy",
  },
  {
    name: "QAPI program",
    requirement:
      "An ongoing, data-driven quality assessment and performance improvement program.",
    cycle: "Ongoing",
    citation: "42 CFR 416.43",
    url: ecfr(42, "416.43"),
    when: ["asc"],
    help: "/glossary/qapi",
  },
  {
    name: "Emergency preparedness program (ASC)",
    requirement:
      "Emergency plan, policies and procedures, communication plan, and training and testing program.",
    cycle:
      "Each reviewed at least every 2 years; plan tested at least annually",
    citation: "42 CFR 416.54",
    url: ecfr(42, "416.54"),
    when: ["asc"],
    help: "/templates/emergency-preparedness-policy",
  },
  {
    name: "Complaint investigation",
    requirement:
      "Investigate complaints, document them and their resolution, and prevent retaliation while investigating.",
    cycle: "Not set",
    citation: "42 CFR 484.50(e)",
    url: ecfr(42, "484.50"),
    when: ["hha"],
    help: "/templates/patient-grievance-policy",
  },
  {
    name: "Infection prevention and control program (home health)",
    requirement:
      "A documented infection control program following accepted standards of practice.",
    cycle: "Not set",
    citation: "42 CFR 484.70",
    url: ecfr(42, "484.70"),
    when: ["hha"],
    help: "/templates/hand-hygiene-policy",
  },
  {
    name: "QAPI program (home health)",
    requirement:
      "An effective, ongoing, agency-wide, data-driven QAPI program.",
    cycle: "Ongoing",
    citation: "42 CFR 484.65",
    url: ecfr(42, "484.65"),
    when: ["hha"],
    help: "/glossary/qapi",
  },
  {
    name: "Emergency preparedness program (home health)",
    requirement:
      "Emergency plan, policies including individual patient plans, communication plan, and training and testing.",
    cycle: "Each reviewed at least every 2 years",
    citation: "42 CFR 484.102",
    url: ecfr(42, "484.102"),
    when: ["hha"],
    help: "/templates/emergency-preparedness-policy",
  },
  {
    name: "Controlled drugs in the patient's home",
    requirement:
      "Written policies on managing and disposing of controlled drugs in the home, given to and discussed with the family when first ordered.",
    cycle: "Not set",
    citation: "42 CFR 418.106(e)(2)",
    url: ecfr(42, "418.106"),
    when: ["hospice"],
    help: "/templates/controlled-drug-disposal-policy",
  },
  {
    name: "Infection control program (hospice)",
    requirement:
      "An effective, documented infection control program following accepted standards of practice.",
    cycle: "Not set",
    citation: "42 CFR 418.60",
    url: ecfr(42, "418.60"),
    when: ["hospice"],
    help: "/templates/hand-hygiene-policy",
  },
  {
    name: "QAPI program (hospice)",
    requirement:
      "An effective, ongoing, hospice-wide, data-driven QAPI program.",
    cycle: "Ongoing",
    citation: "42 CFR 418.58",
    url: ecfr(42, "418.58"),
    when: ["hospice"],
    help: "/glossary/qapi",
  },
  {
    name: "Emergency preparedness program (hospice)",
    requirement:
      "Emergency plan, policies and procedures, communication plan, and training and testing program.",
    cycle: "Each reviewed at least every 2 years",
    citation: "42 CFR 418.113",
    url: ecfr(42, "418.113"),
    when: ["hospice"],
    help: "/templates/emergency-preparedness-policy",
  },
  {
    name: "Patient care policies",
    requirement:
      "Written policies developed with a professional group that includes a physician, a PA or NP, and a member from outside the clinic.",
    cycle: "Reviewed at least biennially by that group",
    citation: "42 CFR 491.9(b)",
    url: ecfr(42, "491.9"),
    when: ["rhc"],
    help: "/for/rural-health-clinics",
  },
  {
    name: "Program evaluation",
    requirement:
      "An evaluation of the total program, including a review of the health care policies.",
    cycle: "Biennially",
    citation: "42 CFR 491.11",
    url: ecfr(42, "491.11"),
    when: ["rhc"],
  },
  {
    name: "Emergency preparedness program (RHC/FQHC)",
    requirement:
      "Emergency plan, policies and procedures, communication plan, and training and testing program.",
    cycle: "Each reviewed at least every 2 years",
    citation: "42 CFR 491.12",
    url: ecfr(42, "491.12"),
    when: ["rhc"],
    help: "/templates/emergency-preparedness-policy",
  },
  {
    name: "Quality assurance and quality control plans",
    requirement:
      "Current QA and QC plans, including annual reviews of program policies and procedures.",
    cycle: "Policies reviewed annually",
    citation: "42 CFR 8.12(c)(1)",
    url: ecfr(42, "8.12"),
    when: ["otp"],
    help: "/for/behavioral-health",
  },
  {
    name: "Diversion control plan",
    requirement:
      "A current diversion control plan, as part of the quality assurance program.",
    cycle: "Kept current",
    citation: "42 CFR 8.12(c)(2)",
    url: ecfr(42, "8.12"),
    when: ["otp"],
    help: "/for/behavioral-health",
  },
  {
    name: "Security for records",
    requirement:
      "Formal policies and procedures to protect patient identifying information against unauthorized use and disclosure.",
    cycle: "Not set",
    citation: "42 CFR 2.16",
    url: ecfr(42, "2.16"),
    when: ["part2"],
    help: "/for/behavioral-health",
  },
];

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Filters the rows by the ticked situations; nothing ticked shows them all. */
const SCRIPT = `(function(){
  var form=document.getElementById("rp-filter");
  var rows=[].slice.call(document.querySelectorAll("#rp-table tbody tr"));
  var count=document.getElementById("rp-count");
  function update(){
    var on=[].slice.call(form.querySelectorAll("input:checked")).map(function(i){return i.value;});
    var shown=0;
    rows.forEach(function(row){
      var show=!on.length||row.getAttribute("data-when").split(" ").some(function(k){return on.indexOf(k)>=0;});
      row.hidden=!show; if(show)shown++;
    });
    count.textContent=on.length?shown+" of "+rows.length+" apply to you":"All "+rows.length+" shown. Tick what describes you.";
  }
  form.hidden=false; form.addEventListener("change",update); update();
})();`;

export function requiredPoliciesHtml(): string {
  const boxes = SITUATIONS.map(
    (situation) =>
      `<label><input type="checkbox" value="${situation.key}"> ${escape(situation.label)}</label>`,
  ).join("");
  const rows = REQUIRED_POLICIES.map(
    (policy) =>
      `<tr data-when="${policy.when.join(" ")}"><td><strong>${escape(policy.name)}</strong>${
        policy.help ? `<br><a href="${policy.help}">How to write it</a>` : ""
      }</td><td>${escape(policy.requirement)}</td><td>${escape(policy.cycle)}</td><td><a href="${policy.url}">${escape(policy.citation)}</a></td></tr>`,
  ).join("");
  return `<section class="site-tool" aria-label="Required policies checklist">
<form id="rp-filter" class="site-tool-filter" hidden><fieldset><legend>Which describe your organization?</legend>${boxes}</fieldset><p id="rp-count" role="status"></p></form>
<table id="rp-table"><thead><tr><th>Policy, plan or program</th><th>What the rule requires</th><th>Review or retention</th><th>Rule</th></tr></thead><tbody>${rows}</tbody></table>
<script>${SCRIPT}</script>
</section>`;
}

export function requiredPoliciesMarkdown(): string {
  const label = (key: string) =>
    SITUATIONS.find((situation) => situation.key === key)?.label ?? key;
  const lines = [
    "| Policy, plan or program | Applies when | What the rule requires | Review or retention | Rule |",
    "| --- | --- | --- | --- | --- |",
    ...REQUIRED_POLICIES.map(
      (policy) =>
        `| ${policy.name} | ${policy.when.map(label).join("; ")} | ${policy.requirement} | ${policy.cycle} | [${policy.citation}](${policy.url}) |`,
    ),
  ];
  return lines.join("\n");
}

/** Free tools by slug: the data-built part of each `/tools` page. */
export const TOOLS: Record<string, () => { html: string; markdown: string }> = {
  "required-policies-checklist": () => ({
    html: requiredPoliciesHtml(),
    markdown: requiredPoliciesMarkdown(),
  }),
};
