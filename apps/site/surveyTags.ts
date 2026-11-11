import {
  ecfrSection,
  EMERGENCY_APPENDIX,
  manualRows,
  POLICY_MANUALS,
  type PolicyManual,
} from "./policyManuals";

/**
 * The survey tag pages at `/survey-tags/{slug}`: the numbers a surveyor
 * writes on a CMS-2567, looked up the other way round from a policy manual
 * index. A person cited under G462 searches for "G462".
 *
 * Each page has two tables. The first is the provider's condition-level
 * tags, one per condition, read from the State Operations Manual appendix
 * that prints them. The second is every tag a row of the provider's manual
 * index (`policyManuals.ts`) cites, with the policy that answers it, so the
 * two pages cannot disagree.
 *
 * Emergency preparedness is its own page: Appendix Z gives every provider the
 * same E-tags, and only the section of the rule differs.
 */

export interface ConditionTag {
  tag: string;
  /** The section the tag stands for: "416.41". */
  section: string;
  /** The condition's name, as the rule heads it. */
  name: string;
}

export interface TagPage {
  /** The page's slug under `/survey-tags`. */
  slug: string;
  /** The manual index whose rows this page's second table is built from. */
  manual: PolicyManual;
  conditions: readonly ConditionTag[];
}

const manual = (slug: string) =>
  POLICY_MANUALS.find((entry) => entry.slug === slug)!;

const conditions = (
  ...entries: [tag: string, section: string, name: string][]
): ConditionTag[] =>
  entries.map(([tag, section, name]) => ({ tag, section, name }));

export const TAG_PAGES: readonly TagPage[] = [
  {
    slug: "asc-q-tags",
    manual: manual("asc-policy-and-procedure-manual"),
    conditions: conditions(
      ["Q-0020", "416.40", "Compliance with State licensure law"],
      ["Q-0040", "416.41", "Governing body and management"],
      ["Q-0060", "416.42", "Surgical services"],
      ["Q-0080", "416.43", "Quality assessment and performance improvement"],
      ["Q-0100", "416.44", "Environment"],
      ["Q-0120", "416.45", "Medical staff"],
      ["Q-0140", "416.46", "Nursing services"],
      ["Q-0160", "416.47", "Medical records"],
      ["Q-0180", "416.48", "Pharmaceutical services"],
      ["Q-0200", "416.49", "Laboratory and radiologic services"],
      ["Q-0219", "416.50", "Patient rights"],
      ["Q-0240", "416.51", "Infection control"],
      ["Q-0260", "416.52", "Patient admission, assessment and discharge"],
    ),
  },
  {
    slug: "home-health-g-tags",
    manual: manual("home-health-policy-and-procedure-manual"),
    conditions: conditions(
      ["G350", "484.40", "Release of patient identifiable OASIS information"],
      ["G370", "484.45", "Reporting OASIS information"],
      ["G406", "484.50", "Patient rights"],
      ["G510", "484.55", "Comprehensive assessment of patients"],
      ["G560", "484.58", "Discharge planning"],
      [
        "G570",
        "484.60",
        "Care planning, coordination of services, and quality of care",
      ],
      ["G640", "484.65", "Quality assessment and performance improvement"],
      ["G680", "484.70", "Infection prevention and control"],
      ["G700", "484.75", "Skilled professional services"],
      ["G750", "484.80", "Home health aide services"],
      ["G848", "484.100", "Compliance with Federal, State, and local laws"],
      ["G940", "484.105", "Organization and administration of services"],
      ["G1008", "484.110", "Clinical records"],
      ["G1050", "484.115", "Personnel qualifications"],
    ),
  },
  {
    slug: "hospice-l-tags",
    manual: manual("hospice-policy-and-procedure-manual"),
    conditions: conditions(
      ["L500", "418.52", "Patient's rights"],
      ["L520", "418.54", "Initial and comprehensive assessment of the patient"],
      [
        "L536",
        "418.56",
        "Interdisciplinary group, care planning, and coordination of services",
      ],
      ["L559", "418.58", "Quality assessment and performance improvement"],
      ["L577", "418.60", "Infection control"],
      ["L583", "418.62", "Licensed professional services"],
      ["L587", "418.64", "Core services"],
      [
        "L599",
        "418.66",
        "Nursing services: waiver of the requirement to provide them directly",
      ],
      ["L601", "418.70", "Furnishing of non-core services"],
      [
        "L603",
        "418.72",
        "Physical therapy, occupational therapy, and speech-language pathology",
      ],
      ["L607", "418.76", "Hospice aide and homemaker services"],
      ["L641", "418.78", "Volunteers"],
      ["L648", "418.100", "Organization and administration of services"],
      ["L664", "418.102", "Medical director"],
      ["L670", "418.104", "Clinical records"],
      [
        "L686",
        "418.106",
        "Drugs and biologicals, medical supplies, and durable medical equipment",
      ],
      ["L704", "418.108", "Short-term inpatient care"],
      ["L820", "418.110", "Hospices that provide inpatient care directly"],
      [
        "L759",
        "418.112",
        "Hospices that provide hospice care to residents of a SNF/NF or ICF/IID",
      ],
      ["L783", "418.114", "Personnel qualifications"],
      ["L797", "418.116", "Compliance with Federal, State, and local laws"],
    ),
  },
  {
    slug: "rural-health-clinic-j-tags",
    manual: manual("rural-health-clinic-policy-and-procedure-manual"),
    conditions: conditions(
      ["J-0010", "491.4", "Compliance with Federal, State and local laws"],
      ["J-0020", "491.5", "Location of clinic"],
      ["J-0040", "491.6", "Physical plant and environment"],
      ["J-0060", "491.7", "Organizational structure"],
      ["J-0080", "491.8", "Staffing and staff responsibilities"],
      ["J-0120", "491.9", "Provision of services"],
      ["J-0150", "491.10", "Patient health records"],
      ["J-0160", "491.11", "Program evaluation"],
    ),
  },
];

/** The address of the emergency preparedness page, which every other links to. */
export const EMERGENCY_TAGS_PATH = "/survey-tags/emergency-preparedness-e-tags";

export interface EmergencyTag {
  tag: string;
  /** The paragraph of the provider's emergency preparedness section. */
  paragraph: string;
  name: string;
  requirement: string;
}

/**
 * The E-tags the four providers on this site share, as Appendix Z lists them.
 * Each was checked to name §416.54, §418.113, §484.102 and §491.12 at the
 * paragraph given.
 */
export const EMERGENCY_TAGS: readonly EmergencyTag[] = [
  {
    tag: "E-0001",
    paragraph: "",
    name: "Emergency preparedness program",
    requirement:
      "Comply with all applicable federal, state and local emergency preparedness requirements, and establish and maintain an emergency preparedness program.",
  },
  {
    tag: "E-0004",
    paragraph: "(a)",
    name: "Emergency plan",
    requirement:
      "Develop and maintain an emergency preparedness plan, reviewed and updated at least every 2 years.",
  },
  {
    tag: "E-0006",
    paragraph: "(a)(1)–(2)",
    name: "Risk assessment and strategies",
    requirement:
      "Base the plan on a documented, facility-based and community-based risk assessment using an all-hazards approach, and include strategies for the emergencies it identifies.",
  },
  {
    tag: "E-0007",
    paragraph: "(a)(3)",
    name: "Patient population and continuity of operations",
    requirement:
      "Address the patient population, the services the provider can offer in an emergency, and continuity of operations, including delegations of authority and succession plans.",
  },
  {
    tag: "E-0009",
    paragraph: "(a)(4)",
    name: "Cooperation with emergency officials",
    requirement:
      "Include a process for cooperation and collaboration with local, tribal, regional, state and federal emergency preparedness officials.",
  },
  {
    tag: "E-0013",
    paragraph: "(b)",
    name: "Policies and procedures",
    requirement:
      "Develop and implement emergency preparedness policies and procedures based on the plan, the risk assessment and the communication plan, reviewed and updated at least every 2 years.",
  },
  {
    tag: "E-0029",
    paragraph: "(c)",
    name: "Communication plan",
    requirement:
      "Develop and maintain a communication plan that complies with federal, state and local laws, reviewed and updated at least every 2 years.",
  },
  {
    tag: "E-0036",
    paragraph: "(d)",
    name: "Training and testing program",
    requirement:
      "Develop and maintain a training and testing program based on the plan, the risk assessment, the policies and procedures and the communication plan, reviewed and updated at least every 2 years.",
  },
  {
    tag: "E-0037",
    paragraph: "(d)(1)",
    name: "Training",
    requirement:
      "Train staff in the emergency preparedness policies and procedures, keep documentation of the training, and show that staff know the emergency procedures.",
  },
  {
    tag: "E-0039",
    paragraph: "(d)(2)",
    name: "Testing",
    requirement:
      "Conduct exercises to test the emergency plan, analyze the response, and revise the plan as needed.",
  },
  {
    tag: "E-0042",
    paragraph: "(e)",
    name: "Integrated healthcare systems",
    requirement:
      "A provider in a healthcare system with a unified and integrated emergency preparedness program may take part in it, if the program meets the rule's terms for each facility.",
  },
];

/** Each provider's emergency preparedness section, for the E-tag page. */
export const EMERGENCY_SECTIONS: readonly {
  provider: string;
  section: string;
}[] = [
  { provider: "Ambulatory surgery centers", section: "416.54" },
  { provider: "Hospices", section: "418.113" },
  { provider: "Home health agencies", section: "484.102" },
  { provider: "Rural health clinics and FQHCs", section: "491.12" },
];

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A provider's name inside a sentence: only its first letter changes. */
const lower = (text: string) => text[0]!.toLowerCase() + text.slice(1);

/** A page's rows with a tag from its own appendix, in the appendix's order. */
export function policyTagRows(page: TagPage) {
  const number = (tag: string) => Number(tag.replace(/\D/g, "").slice(0, 4));
  return manualRows(page.manual)
    .filter((row) => row.tag?.startsWith(page.manual.appendix.letter))
    .sort((a, b) => number(a.tag!) - number(b.tag!));
}

const manualPath = (page: TagPage) => `/manuals/${page.manual.slug}`;

export function tagPageHtml(page: TagPage): string {
  const conditionRows = page.conditions
    .map(
      (entry) =>
        `<tr><td><span class="site-manual-tag">${escape(entry.tag)}</span></td><td>${escape(entry.name)}</td><td><a href="${ecfrSection(entry.section)}">42 CFR ${escape(entry.section)}</a></td></tr>`,
    )
    .join("");
  const policyRows = policyTagRows(page)
    .map(
      (row) =>
        `<tr><td><span class="site-manual-tag">${escape(row.tag!)}</span></td><td><strong>${escape(row.name)}</strong>${
          row.help ? `<br><a href="${row.help}">How to write it</a>` : ""
        }</td><td>${escape(row.requirement)}<br><a href="${ecfrSection(row.section)}">${escape(row.citation)}</a></td></tr>`,
    )
    .join("");
  return `<section class="site-tool site-manual" aria-label="Survey tags">
<h3>Tags that turn on a written policy</h3>
<table><thead><tr><th>Tag</th><th>The policy a surveyor reads</th><th>What the rule says</th></tr></thead><tbody>${policyRows}</tbody></table>
<h3>Condition-level tags</h3>
<table><thead><tr><th>Tag</th><th>Condition</th><th>Rule</th></tr></thead><tbody>${conditionRows}<tr><td><span class="site-manual-tag">E-0001</span></td><td>Emergency preparedness (<a href="${EMERGENCY_TAGS_PATH}">the E-tags</a>)</td><td><a href="${ecfrSection(emergencySection(page))}">42 CFR ${emergencySection(page)}</a></td></tr></tbody></table>
</section>`;
}

/** The provider's emergency preparedness section, from its manual index. */
function emergencySection(page: TagPage): string {
  return page.manual.sections.at(-1)!.rows[0]!.section;
}

export function tagPageMarkdown(page: TagPage): string {
  return [
    "### Tags that turn on a written policy",
    "",
    "| Tag | The policy a surveyor reads | What the rule says | Rule |",
    "| --- | --- | --- | --- |",
    ...policyTagRows(page).map(
      (row) =>
        `| ${row.tag} | ${row.name} | ${row.requirement} | [${row.citation}](${ecfrSection(row.section)}) |`,
    ),
    "",
    "### Condition-level tags",
    "",
    "| Tag | Condition | Rule |",
    "| --- | --- | --- |",
    ...page.conditions.map(
      (entry) =>
        `| ${entry.tag} | ${entry.name} | [42 CFR ${entry.section}](${ecfrSection(entry.section)}) |`,
    ),
    `| E-0001 | Emergency preparedness | [42 CFR ${emergencySection(page)}](${ecfrSection(emergencySection(page))}) |`,
    "",
    `The policy behind each tag, by section of the manual: https://bindersnap.com${manualPath(page)}`,
  ].join("\n");
}

export function emergencyTagsHtml(): string {
  const head = EMERGENCY_SECTIONS.map(
    (entry) =>
      `<a href="${ecfrSection(entry.section)}">§${escape(entry.section)}</a> ${escape(lower(entry.provider))}`,
  ).join(" · ");
  const rows = EMERGENCY_TAGS.map(
    (entry) =>
      `<tr><td><span class="site-manual-tag">${escape(entry.tag)}</span></td><td><strong>${escape(entry.name)}</strong>${
        entry.paragraph
          ? `<br><span class="site-manual-kind">Paragraph ${escape(entry.paragraph)}</span>`
          : ""
      }</td><td>${escape(entry.requirement)}</td></tr>`,
  ).join("");
  return `<section class="site-tool site-manual" aria-label="Emergency preparedness tags">
<p class="site-manual-kind">The paragraph is the same in each provider's section: ${head}.</p>
<table><thead><tr><th>Tag</th><th>Requirement</th><th>What the rule says</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

export function emergencyTagsMarkdown(): string {
  return [
    `The paragraph is the same in each provider's section: ${EMERGENCY_SECTIONS.map(
      (entry) =>
        `[§${entry.section}](${ecfrSection(entry.section)}) for ${lower(entry.provider)}`,
    ).join(", ")}.`,
    "",
    "| Tag | Requirement | Paragraph | What the rule says |",
    "| --- | --- | --- | --- |",
    ...EMERGENCY_TAGS.map(
      (entry) =>
        `| ${entry.tag} | ${entry.name} | ${entry.paragraph || "Opening"} | ${entry.requirement} |`,
    ),
    "",
    `Source: State Operations Manual, ${EMERGENCY_APPENDIX.name} (${EMERGENCY_APPENDIX.revision}).`,
  ].join("\n");
}

/** The data-built part of each `/survey-tags` page, by the page's address. */
export const TAG_PARTS: Record<
  string,
  () => { html: string; markdown: string }
> = {
  ...Object.fromEntries(
    TAG_PAGES.map((page) => [
      `/survey-tags/${page.slug}`,
      () => ({ html: tagPageHtml(page), markdown: tagPageMarkdown(page) }),
    ]),
  ),
  [EMERGENCY_TAGS_PATH]: () => ({
    html: emergencyTagsHtml(),
    markdown: emergencyTagsMarkdown(),
  }),
};
