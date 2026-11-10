import { documentToDocx } from "../../services/api/export/documentDocx";
import { documentBlocks } from "../../services/api/export/documentBlocks";
import { trackAttributes } from "./analytics";
import { GUIDANCE_NOTICE } from "./siteContent";
import { markdownToDocument } from "./templateDocument";

/**
 * The policy manual indexes at `/manuals/{slug}`: for one kind of provider,
 * every policy, procedure, plan and program its Medicare conditions ask for,
 * in the order a manual is usually bound, with the rule behind each and the
 * tag a surveyor cites it under.
 *
 * Every row was checked against two sources, and a change to one is checked
 * against both again:
 *
 * - the rule, in the current eCFR text (42 CFR Parts 416, 418, 484 and 491);
 * - the tag, in the State Operations Manual appendix for that provider
 *   (`appendix` below), which prints each tag above the rule it stands for.
 *
 * `named` is the line the page is careful about: true only where the rule's
 * own words ask for a policy, a procedure, a plan or a program. Where it is
 * false the rule sets a requirement that providers meet through a written
 * policy, and the page says so instead of calling the policy required.
 *
 * The same rows are the page's table, its Markdown copy, and the Word file a
 * person downloads to fill in.
 */

export interface ManualRow {
  name: string;
  /** What the rule says, in or close to its own words. */
  requirement: string;
  /** The rule itself asks for a policy, procedure, plan or program. */
  named: boolean;
  /** Only for providers this describes: "If you …". */
  when?: string;
  /** How often the rule says to review it, or how long to keep it. */
  cycle?: string;
  /** As a person would cite it: "42 CFR 416.41(b)(1)". */
  citation: string;
  /** The section the citation links to: "416.41". */
  section: string;
  /** The survey tag, as its appendix prints it. */
  tag?: string;
  /** A page on this site that helps write it. */
  help?: string;
}

export interface ManualSection {
  title: string;
  rows: readonly ManualRow[];
}

export interface PolicyManual {
  /** The page's slug under `/manuals`. */
  slug: string;
  /** "an ambulatory surgery center", for a sentence. */
  provider: string;
  /** The Word file's title. */
  title: string;
  /** What CMS calls this provider's rules. */
  conditions: string;
  appendix: {
    /** "Appendix L" */
    name: string;
    /** The letter its tags start with. */
    letter: string;
    url: string;
    /** The revision the tags were read from. */
    revision: string;
  };
  sections: readonly ManualSection[];
}

const SOM = "https://www.cms.gov/Regulations-and-Guidance/Guidance/Manuals";

/** Appendix Z, where every provider's emergency preparedness tags are. */
export const EMERGENCY_APPENDIX = {
  name: "Appendix Z",
  letter: "E",
  url: `${SOM}/downloads/som107ap_z_emergprep.pdf`,
  revision: "Rev. 204, issued April 16, 2021",
};

export const ecfrSection = (section: string) =>
  `https://www.ecfr.gov/current/title-42/section-${section}`;

/**
 * The four parts of an emergency preparedness program. The rule is worded the
 * same for every provider here, and so are its tags: only the section differs.
 */
function emergencyPreparedness(section: string): ManualSection {
  const row = (
    name: string,
    paragraph: string,
    tag: string,
    requirement: string,
    cycle: string,
  ): ManualRow => ({
    name,
    requirement,
    named: true,
    cycle,
    citation: `42 CFR ${section}(${paragraph})`,
    section,
    tag,
    help: "/templates/emergency-preparedness-policy",
  });
  return {
    title: "Emergency preparedness",
    rows: [
      row(
        "Emergency plan",
        "a",
        "E-0004",
        "An emergency preparedness plan based on a documented, facility-based and community-based risk assessment, using an all-hazards approach.",
        "Reviewed and updated at least every 2 years",
      ),
      row(
        "Emergency policies and procedures",
        "b",
        "E-0013",
        "Emergency preparedness policies and procedures based on the emergency plan, the risk assessment and the communication plan.",
        "Reviewed and updated at least every 2 years",
      ),
      row(
        "Emergency communication plan",
        "c",
        "E-0029",
        "A communication plan that complies with federal, state and local laws, with the names and contact information the rule lists.",
        "Reviewed and updated at least every 2 years",
      ),
      row(
        "Emergency training and testing program",
        "d",
        "E-0036",
        "A training and testing program based on the plan, the risk assessment, the policies and procedures and the communication plan.",
        "Reviewed and updated at least every 2 years",
      ),
    ],
  };
}

export const POLICY_MANUALS: readonly PolicyManual[] = [
  {
    slug: "asc-policy-and-procedure-manual",
    provider: "an ambulatory surgery center",
    title: "Ambulatory surgery center policy and procedure manual: index",
    conditions: "Conditions for Coverage, 42 CFR Part 416, Subpart C",
    appendix: {
      name: "Appendix L",
      letter: "Q",
      url: `${SOM}/downloads/som107ap_l_ambulatory.pdf`,
      revision: "Rev. 215, July 21, 2023",
    },
    sections: [
      {
        title: "Governing body and management",
        rows: [
          {
            name: "Policies governing the ASC's total operation",
            requirement:
              "The governing body assumes full legal responsibility for determining, implementing and monitoring policies governing the ASC's total operation.",
            named: true,
            citation: "42 CFR 416.41",
            section: "416.41",
            tag: "Q-0040",
            help: "/templates/policy-review-and-approval",
          },
          {
            name: "Contract services",
            requirement:
              "When services are provided through a contract with an outside resource, the ASC must assure they are provided in a safe and effective manner.",
            named: false,
            citation: "42 CFR 416.41(a)",
            section: "416.41",
            tag: "Q-0041",
          },
          {
            name: "Hospital transfer procedure",
            requirement:
              "An effective procedure for the immediate transfer, to a hospital, of patients requiring emergency medical care beyond the capabilities of the ASC.",
            named: true,
            citation: "42 CFR 416.41(b)(1)",
            section: "416.41",
            tag: "Q-0042",
          },
        ],
      },
      {
        title: "Surgical and anesthesia services",
        rows: [
          {
            name: "Clinical privileges for surgery",
            requirement:
              "Surgical procedures are performed by qualified physicians granted clinical privileges by the governing body in accordance with approved policies and procedures of the ASC.",
            named: true,
            citation: "42 CFR 416.42",
            section: "416.42",
            tag: "Q-0060",
          },
          {
            name: "Evaluation for anesthesia recovery before discharge",
            requirement:
              "Before discharge, each patient is evaluated by a physician or an anesthetist for proper anesthesia recovery, in accordance with state law, standards of practice and ASC policy.",
            named: true,
            citation: "42 CFR 416.42(a)(2)",
            section: "416.42",
            tag: "Q-0062",
          },
        ],
      },
      {
        title: "Quality assessment and performance improvement",
        rows: [
          {
            name: "QAPI program",
            requirement:
              "An ongoing, data-driven quality assessment and performance improvement program, which the governing body ensures is defined, implemented and maintained.",
            named: true,
            cycle: "Ongoing",
            citation: "42 CFR 416.43",
            section: "416.43",
            tag: "Q-0080",
            help: "/glossary/qapi",
          },
        ],
      },
      {
        title: "Environment",
        rows: [
          {
            name: "Emergency equipment",
            requirement:
              "The medical staff and governing body coordinate, develop and revise policies and procedures that specify the types of emergency equipment required for use in the operating room.",
            named: true,
            citation: "42 CFR 416.44(d)",
            section: "416.44",
            tag: "Q-0109",
          },
        ],
      },
      {
        title: "Medical staff",
        rows: [
          {
            name: "Privileging and reappraisal",
            requirement:
              "The ASC grants privileges in accordance with recommendations from qualified medical personnel, and periodically reappraises them.",
            named: false,
            cycle: "Privileges reappraised periodically",
            citation: "42 CFR 416.45(a)–(b)",
            section: "416.45",
            tag: "Q-0121, Q-0122",
          },
          {
            name: "Oversight of practitioners other than physicians",
            requirement:
              "Established policies and procedures, approved by the governing body, for overseeing and evaluating their clinical activities.",
            named: true,
            when: "If you assign patient care to practitioners other than physicians",
            citation: "42 CFR 416.45(c)",
            section: "416.45",
            tag: "Q-0123",
          },
        ],
      },
      {
        title: "Nursing services",
        rows: [
          {
            name: "Nursing responsibilities",
            requirement:
              "Patient care responsibilities must be delineated for all nursing service personnel.",
            named: false,
            citation: "42 CFR 416.46(a)",
            section: "416.46",
            tag: "Q-0141",
          },
        ],
      },
      {
        title: "Medical records",
        rows: [
          {
            name: "Medical record system",
            requirement:
              "A system for the proper collection, storage and use of patient records.",
            named: false,
            citation: "42 CFR 416.47(a)",
            section: "416.47",
            tag: "Q-0161",
          },
        ],
      },
      {
        title: "Pharmaceutical services",
        rows: [
          {
            name: "Preparing and administering drugs",
            requirement:
              "Drugs must be prepared and administered according to established policies and acceptable standards of practice.",
            named: true,
            citation: "42 CFR 416.48(a)",
            section: "416.48",
            tag: "Q-0181",
          },
        ],
      },
      {
        title: "Laboratory and radiologic services",
        rows: [
          {
            name: "Obtaining laboratory services",
            requirement:
              "Procedures for obtaining routine and emergency laboratory services from a certified laboratory.",
            named: true,
            when: "If you do not run your own laboratory",
            citation: "42 CFR 416.49(a)",
            section: "416.49",
            tag: "Q-0201",
          },
          {
            name: "Responsibility for radiologic services",
            requirement:
              "The governing body appoints an individual, qualified in accordance with state law and ASC policies, who is responsible for radiologic services.",
            named: true,
            when: "If you use radiologic services",
            citation: "42 CFR 416.49(b)(2)",
            section: "416.49",
            tag: "Q-0204",
          },
        ],
      },
      {
        title: "Patient rights",
        rows: [
          {
            name: "Notice of patient rights",
            requirement:
              "Verbal and written notice of the patient's rights before the procedure starts, and the written notice posted where patients wait.",
            named: false,
            citation: "42 CFR 416.50(a)",
            section: "416.50",
            tag: "Q-0221",
          },
          {
            name: "Advance directives",
            requirement:
              "Written information for the patient on the ASC's policies on advance directives, including a description of applicable state law.",
            named: true,
            citation: "42 CFR 416.50(c)",
            section: "416.50",
            tag: "Q-0224",
          },
          {
            name: "Grievance procedure",
            requirement:
              "A grievance procedure for documenting the existence, submission, investigation and disposition of a patient's written or verbal grievance, with timeframes and a written decision.",
            named: true,
            citation: "42 CFR 416.50(d)",
            section: "416.50",
            tag: "Q-0225",
            help: "/templates/patient-grievance-policy",
          },
        ],
      },
      {
        title: "Infection control",
        rows: [
          {
            name: "Infection control program",
            requirement:
              "An ongoing program to prevent, control and investigate infections and communicable diseases, with documentation that the ASC considered, selected and implemented nationally recognized guidelines.",
            named: true,
            cycle: "Ongoing",
            citation: "42 CFR 416.51(b)",
            section: "416.51",
            tag: "Q-0242",
            help: "/templates/hand-hygiene-policy",
          },
        ],
      },
      {
        title: "Admission, assessment and discharge",
        rows: [
          {
            name: "History and physical examination policy",
            requirement:
              "A policy that identifies the patients who require a medical history and physical examination before surgery, and the timeframe for completing it.",
            named: true,
            citation: "42 CFR 416.52(a)(1)",
            section: "416.52",
            tag: "Q-0261",
          },
          {
            name: "Pre-surgical assessment",
            requirement:
              "On admission, a pre-surgical assessment by the physician performing the surgery or another qualified practitioner, in accordance with state law, standards of practice and ASC policy.",
            named: true,
            citation: "42 CFR 416.52(a)(2)",
            section: "416.52",
            tag: "Q-0262",
          },
          {
            name: "Post-surgical assessment",
            requirement:
              "The patient's post-surgical condition is assessed and documented in accordance with state law, standards of practice and ASC policy.",
            named: true,
            citation: "42 CFR 416.52(b)",
            section: "416.52",
            tag: "Q-0264",
          },
          {
            name: "Discharge",
            requirement:
              "Written discharge instructions, a discharge order signed by the physician in accordance with ASC policy, and discharge in the company of a responsible adult.",
            named: true,
            citation: "42 CFR 416.52(c)",
            section: "416.52",
            tag: "Q-0265 to Q-0267",
          },
        ],
      },
      emergencyPreparedness("416.54"),
    ],
  },
  {
    slug: "home-health-policy-and-procedure-manual",
    provider: "a home health agency",
    title: "Home health agency policy and procedure manual: index",
    conditions: "Conditions of Participation, 42 CFR Part 484",
    appendix: {
      name: "Appendix B",
      letter: "G",
      url: `${SOM}/downloads/som107ap_b_hha.pdf`,
      revision: "Rev. 245, issued August 5, 2026",
    },
    sections: [
      {
        title: "Organization and administration",
        rows: [
          {
            name: "Governing body responsibility",
            requirement:
              "A governing body assumes full legal authority and responsibility for the agency's overall management and operation.",
            named: false,
            citation: "42 CFR 484.105(a)",
            section: "484.105",
            tag: "G942",
            help: "/templates/policy-review-and-approval",
          },
          {
            name: "Personnel qualifications and policies",
            requirement:
              "The administrator ensures the HHA employs qualified personnel, including assuring the development of personnel qualifications and policies.",
            named: true,
            citation: "42 CFR 484.105(b)(1)(iv)",
            section: "484.105",
            tag: "G952",
          },
          {
            name: "Patient acceptance-to-service policy",
            requirement:
              "A policy applied consistently to each prospective patient referred for home health care, addressing the HHA's capacity to provide patient care.",
            named: true,
            cycle: "Maintained through an annual review",
            citation: "42 CFR 484.105(i)(1)",
            section: "484.105",
            tag: "G990",
          },
        ],
      },
      {
        title: "Patient rights",
        rows: [
          {
            name: "Transfer and discharge policies",
            requirement:
              "Written notice of the patient's rights and responsibilities, and of the HHA's transfer and discharge policies, during the initial evaluation visit.",
            named: true,
            citation: "42 CFR 484.50(a)(1)(i)",
            section: "484.50",
            tag: "G412",
          },
          {
            name: "Discharge for cause",
            requirement:
              "A policy set by the HHA for addressing discharge for cause, with the steps the rule requires before a patient is discharged.",
            named: true,
            citation: "42 CFR 484.50(d)(5)",
            section: "484.50",
            tag: "G462",
          },
          {
            name: "Investigation of complaints",
            requirement:
              "Investigate complaints, document them and their resolution, and prevent further violations, including retaliation, while investigating.",
            named: false,
            citation: "42 CFR 484.50(e)",
            section: "484.50",
            tag: "G478",
            help: "/templates/patient-grievance-policy",
          },
        ],
      },
      {
        title: "Care planning and orders",
        rows: [
          {
            name: "Influenza and pneumococcal vaccines",
            requirement:
              "Vaccines may be administered per agency policy developed in consultation with a physician, physician assistant, nurse practitioner or clinical nurse specialist.",
            named: true,
            when: "If you give these vaccines without an individual order",
            citation: "42 CFR 484.60(b)(2)",
            section: "484.60",
            tag: "G582",
          },
          {
            name: "Verbal orders",
            requirement:
              "Verbal orders are accepted only by personnel authorized by state law and by the HHA's internal policies.",
            named: true,
            citation: "42 CFR 484.60(b)(3)",
            section: "484.60",
            tag: "G584",
          },
        ],
      },
      {
        title: "Skilled professional services",
        rows: [
          {
            name: "Policies skilled professionals practice under",
            requirement:
              "Skilled professional services are authorized, delivered and supervised only by qualified health care professionals who practice according to the HHA's policies and procedures.",
            named: true,
            citation: "42 CFR 484.75(a)",
            section: "484.75",
            tag: "G702",
          },
        ],
      },
      {
        title: "Quality and infection control",
        rows: [
          {
            name: "QAPI program",
            requirement:
              "An effective, ongoing, HHA-wide, data-driven quality assessment and performance improvement program.",
            named: true,
            cycle: "Ongoing",
            citation: "42 CFR 484.65",
            section: "484.65",
            tag: "G640",
            help: "/glossary/qapi",
          },
          {
            name: "Infection prevention and control program",
            requirement:
              "A documented infection control program, with a coordinated agency-wide program for surveillance, identification, prevention, control and investigation.",
            named: true,
            cycle: "Ongoing",
            citation: "42 CFR 484.70",
            section: "484.70",
            tag: "G680, G684",
            help: "/templates/hand-hygiene-policy",
          },
        ],
      },
      {
        title: "Clinical records",
        rows: [
          {
            name: "Retention of clinical records",
            requirement:
              "The HHA's policies must provide for retention of clinical records even if it discontinues operation.",
            named: true,
            cycle:
              "Records kept 5 years after discharge, or longer under state law",
            citation: "42 CFR 484.110(c)",
            section: "484.110",
            tag: "G1026",
          },
        ],
      },
      emergencyPreparedness("484.102"),
    ],
  },
  {
    slug: "hospice-policy-and-procedure-manual",
    provider: "a hospice",
    title: "Hospice policy and procedure manual: index",
    conditions:
      "Conditions of Participation, 42 CFR Part 418, Subparts C and D",
    appendix: {
      name: "Appendix M",
      letter: "L",
      url: `${SOM}/downloads/som107ap_m_hospice.pdf`,
      revision: "Rev. 222, issued June 7, 2024",
    },
    sections: [
      {
        title: "Organization and administration",
        rows: [
          {
            name: "Governing body responsibility",
            requirement:
              "A governing body assumes full legal authority and responsibility for the management of the hospice.",
            named: false,
            citation: "42 CFR 418.100(b)",
            section: "418.100",
            tag: "L651",
            help: "/templates/policy-review-and-approval",
          },
          {
            name: "Competency assessment",
            requirement:
              "Written policies and procedures describing the hospice's methods of assessing competency, and a written description of the in-service training provided in the previous 12 months.",
            named: true,
            citation: "42 CFR 418.100(g)(3)",
            section: "418.100",
            tag: "L663",
          },
        ],
      },
      {
        title: "Patient rights",
        rows: [
          {
            name: "Advance directives",
            requirement:
              "Written information for the patient on the hospice's policies on advance directives, including a description of applicable state law.",
            named: true,
            citation: "42 CFR 418.52(a)(2)",
            section: "418.52",
            tag: "L503",
          },
          {
            name: "Reporting and investigating alleged violations",
            requirement:
              "Alleged mistreatment, neglect, abuse and misappropriation of patient property are reported immediately to the administrator, and investigated and documented in accordance with established procedures.",
            named: true,
            citation: "42 CFR 418.52(b)(4)",
            section: "418.52",
            tag: "L508",
            help: "/templates/patient-grievance-policy",
          },
          {
            name: "Discharge for cause",
            requirement:
              "A policy set by the hospice for addressing discharge for cause, with the steps the rule requires before a patient is discharged.",
            named: true,
            citation: "42 CFR 418.26(a)(3)",
            section: "418.26",
          },
        ],
      },
      {
        title: "Care planning and coordination",
        rows: [
          {
            name: "Day-to-day care policies",
            requirement:
              "A specifically designated interdisciplinary group establishes the policies governing the day-to-day provision of hospice care and services.",
            named: true,
            when: "If you have more than one interdisciplinary group",
            citation: "42 CFR 418.56(a)(2)",
            section: "418.56",
            tag: "L542",
          },
          {
            name: "Coordination of services",
            requirement:
              "A system of communication and integration, in accordance with the hospice's own policies and procedures.",
            named: true,
            citation: "42 CFR 418.56(e)",
            section: "418.56",
            tag: "L554",
          },
          {
            name: "Policies licensed professionals practice under",
            requirement:
              "Licensed professional services are authorized, delivered and supervised only by qualified health care professionals who practice under the hospice's policies and procedures.",
            named: true,
            citation: "42 CFR 418.62(a)",
            section: "418.62",
            tag: "L584",
          },
          {
            name: "Bereavement program",
            requirement:
              "An organized program for the provision of bereavement services, under the supervision of a qualified professional.",
            named: true,
            citation: "42 CFR 418.64(d)(1)",
            section: "418.64",
            tag: "L596",
          },
        ],
      },
      {
        title: "Quality and infection control",
        rows: [
          {
            name: "QAPI program",
            requirement:
              "An effective, ongoing, hospice-wide, data-driven quality assessment and performance improvement program.",
            named: true,
            cycle: "Ongoing",
            citation: "42 CFR 418.58",
            section: "418.58",
            tag: "L559",
            help: "/glossary/qapi",
          },
          {
            name: "Infection control program",
            requirement:
              "An effective, documented infection control program that protects patients, families, visitors and hospice personnel.",
            named: true,
            cycle: "Ongoing",
            citation: "42 CFR 418.60",
            section: "418.60",
            tag: "L577",
            help: "/templates/hand-hygiene-policy",
          },
        ],
      },
      {
        title: "Clinical records",
        rows: [
          {
            name: "Authentication of entries",
            requirement:
              "All entries are legible, clear, complete, and authenticated and dated in accordance with hospice policy and accepted standards of practice.",
            named: true,
            citation: "42 CFR 418.104(b)",
            section: "418.104",
            tag: "L679",
          },
          {
            name: "Retention and storage of records",
            requirement:
              "If the hospice discontinues operation, hospice policies must provide for retention and storage of clinical records.",
            named: true,
            cycle:
              "Records kept 6 years after death or discharge, or longer under state law",
            citation: "42 CFR 418.104(d)",
            section: "418.104",
            tag: "L681",
          },
        ],
      },
      {
        title: "Drugs, supplies and equipment",
        rows: [
          {
            name: "Controlled drugs in the patient's home",
            requirement:
              "Written policies and procedures for the management and disposal of controlled drugs in the patient's home, given to and discussed with the patient and family when the drugs are first ordered.",
            named: true,
            citation: "42 CFR 418.106(e)(2)(i)",
            section: "418.106",
            tag: "L694",
            help: "/templates/controlled-drug-disposal-policy",
          },
          {
            name: "Dispensing accuracy",
            requirement: "A written policy that promotes dispensing accuracy.",
            named: true,
            when: "If you provide inpatient care directly in your own facility",
            citation: "42 CFR 418.106(c)(2)(i)",
            section: "418.106",
            tag: "L691",
          },
          {
            name: "Repair and maintenance of medical equipment",
            requirement:
              "Where no manufacturer recommendation exists for a piece of equipment, repair and routine maintenance policies are developed.",
            named: true,
            citation: "42 CFR 418.106(f)(1)",
            section: "418.106",
            tag: "L701",
          },
        ],
      },
      {
        title: "Inpatient care",
        rows: [
          {
            name: "Restraint and seclusion",
            requirement:
              "Restraint or seclusion is used only as the rule allows, with the techniques, the physicians who may order it, and their training set by hospice policy.",
            named: true,
            when: "If you provide inpatient care directly in your own facility",
            citation: "42 CFR 418.110(n)",
            section: "418.110",
            tag: "L840",
          },
        ],
      },
      emergencyPreparedness("418.113"),
    ],
  },
  {
    slug: "rural-health-clinic-policy-and-procedure-manual",
    provider: "a rural health clinic",
    title: "Rural health clinic policy and procedure manual: index",
    conditions: "Conditions for Certification, 42 CFR Part 491, Subpart A",
    appendix: {
      name: "Appendix G",
      letter: "J",
      url: `${SOM}/downloads/som107ap_g_rhc.pdf`,
      revision: "Rev. 223, issued June 7, 2024",
    },
    sections: [
      {
        title: "Organizational structure",
        rows: [
          {
            name: "Policies and lines of authority",
            requirement:
              "The organization's policies and its lines of authority and responsibilities are clearly set forth in writing.",
            named: true,
            citation: "42 CFR 491.7(a)(2)",
            section: "491.7",
            tag: "J-0062",
            help: "/templates/policy-review-and-approval",
          },
        ],
      },
      {
        title: "Patient care policies",
        rows: [
          {
            name: "Written patient care policies",
            requirement:
              "Health care services are furnished in accordance with written policies, developed with the advice of a group that includes a physician, a PA or NP, and at least one member who is not on the clinic's staff.",
            named: true,
            cycle: "Reviewed at least biennially by that group",
            citation: "42 CFR 491.9(b)(1)–(2), (4)",
            section: "491.9",
            tag: "J-0123",
            help: "/for/rural-health-clinics",
          },
          {
            name: "Description of services",
            requirement:
              "A description of the services the clinic furnishes directly and those furnished through agreement or arrangement.",
            named: true,
            citation: "42 CFR 491.9(b)(3)(i)",
            section: "491.9",
            tag: "J-0124",
          },
          {
            name: "Guidelines for medical management",
            requirement:
              "Guidelines for the medical management of health problems, including the conditions requiring consultation or referral, the maintenance of health care records, and the periodic review of the clinic's services.",
            named: true,
            citation: "42 CFR 491.9(b)(3)(ii)",
            section: "491.9",
            tag: "J-0124",
          },
          {
            name: "Drugs and biologicals",
            requirement:
              "Rules for the storage, handling and administration of drugs and biologicals.",
            named: true,
            citation: "42 CFR 491.9(b)(3)(iii)",
            section: "491.9",
            tag: "J-0125",
          },
        ],
      },
      {
        title: "Patient health records",
        rows: [
          {
            name: "Clinical record system",
            requirement:
              "The clinic maintains a clinical record system in accordance with written policies and procedures.",
            named: true,
            cycle:
              "Records kept at least 6 years from the last entry, or longer under state law",
            citation: "42 CFR 491.10(a)(1), (c)",
            section: "491.10",
            tag: "J-0151, J-0154",
          },
          {
            name: "Use, removal and release of records",
            requirement:
              "Written policies and procedures govern the use and removal of records from the clinic and the conditions for release of information.",
            named: true,
            citation: "42 CFR 491.10(b)(2)",
            section: "491.10",
            tag: "J-0153",
          },
        ],
      },
      {
        title: "Program evaluation",
        rows: [
          {
            name: "Program evaluation",
            requirement:
              "An evaluation of the total program, including a review of the clinic's health care policies and whether they were followed.",
            named: true,
            cycle: "Biennially",
            citation: "42 CFR 491.11",
            section: "491.11",
            tag: "J-0161",
          },
        ],
      },
      emergencyPreparedness("491.12"),
    ],
  },
];

export function policyManual(slug: string): PolicyManual | undefined {
  return POLICY_MANUALS.find((manual) => manual.slug === slug);
}

export function manualRows(manual: PolicyManual): ManualRow[] {
  return manual.sections.flatMap((section) => section.rows);
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Where a manual's Word file is served. */
export function manualDocxHref(manual: PolicyManual): string {
  return `/manuals/${manual.slug}.docx`;
}

const NAMED = "The rule asks for it in writing";
const IMPLIED = "Met through a written policy";

export function manualHtml(manual: PolicyManual): string {
  const sections = manual.sections
    .map((section) => {
      const rows = section.rows
        .map(
          (row) =>
            `<tr><td><strong>${escape(row.name)}</strong>${
              row.when ? `<br><em>${escape(row.when)}</em>` : ""
            }${
              row.help ? `<br><a href="${row.help}">How to write it</a>` : ""
            }</td><td>${escape(row.requirement)}<br><span class="site-manual-kind">${
              row.named ? NAMED : IMPLIED
            }${row.cycle ? ` · ${escape(row.cycle)}` : ""}</span></td><td><a href="${ecfrSection(
              row.section,
            )}">${escape(row.citation)}</a>${
              row.tag
                ? `<br><span class="site-manual-tag">${escape(row.tag)}</span>`
                : ""
            }</td></tr>`,
        )
        .join("");
      return `<h3>${escape(section.title)}</h3>
<table><thead><tr><th>Policy, plan or program</th><th>What the rule says</th><th>Rule and survey tag</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("\n");
  const count = manualRows(manual).length;
  return `<section class="site-tool site-manual" aria-label="Policy manual index">
<p class="site-download"><a class="site-download-button" href="${manualDocxHref(
    manual,
  )}" download="${manual.slug}.docx"${trackAttributes("manual_download", {
    manual: manual.slug,
  })}>Download as Word (.docx)</a><span>All ${count} rows, with columns for your own document, who approved it and when it is next due.</span></p>
${sections}
</section>`;
}

export function manualMarkdown(manual: PolicyManual): string {
  return manual.sections
    .map((section) =>
      [
        `### ${section.title}`,
        "",
        "| Policy, plan or program | What the rule says | Review or retention | Rule | Survey tag |",
        "| --- | --- | --- | --- | --- |",
        ...section.rows.map(
          (row) =>
            `| ${row.name}${row.when ? ` (${row.when})` : ""} | ${row.requirement} ${
              row.named ? NAMED : IMPLIED
            }. | ${row.cycle ?? "Not set"} | [${row.citation}](${ecfrSection(
              row.section,
            )}) | ${row.tag ?? "None"} |`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

/**
 * The index as the worksheet a person fills in: the rule's columns, then
 * three of their own. Its first line is the page's notice, since a downloaded
 * file travels without its page.
 */
export function manualWorksheetMarkdown(manual: PolicyManual): string {
  return [
    `# ${manual.title}`,
    "",
    `*Index from bindersnap.com/manuals/${manual.slug}. ${GUIDANCE_NOTICE} Delete this note once the index is your own.*`,
    "",
    `The policies, procedures, plans and programs the ${manual.conditions} ask of ${manual.provider}. Fill in the last three columns for each row, then add what your state and your accreditor require.`,
    "",
    ...manual.sections.flatMap((section) => [
      `## ${section.title}`,
      "",
      "| Policy, plan or program | Rule | Survey tag | Our document | Approved by, and when | Next review |",
      "| --- | --- | --- | --- | --- | --- |",
      ...section.rows.map(
        (row) =>
          `| ${row.name}${row.when ? ` (${row.when})` : ""} | ${row.citation} | ${row.tag ?? ""} |  |  |  |`,
      ),
      "",
    ]),
  ].join("\n");
}

export async function manualDocx(manual: PolicyManual): Promise<Uint8Array> {
  const doc = markdownToDocument(manualWorksheetMarkdown(manual));
  return documentToDocx(documentBlocks(doc), { title: manual.title });
}

/** Every manual index's Word file, by the path it is served at. */
export async function manualFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const manual of POLICY_MANUALS) {
    files.set(manualDocxHref(manual), await manualDocx(manual));
  }
  return files;
}

/** The data-built part of each `/manuals` page, by the page's address. */
export const MANUAL_PARTS: Record<
  string,
  () => { html: string; markdown: string }
> = Object.fromEntries(
  POLICY_MANUALS.map((manual) => [
    `/manuals/${manual.slug}`,
    () => ({ html: manualHtml(manual), markdown: manualMarkdown(manual) }),
  ]),
);
