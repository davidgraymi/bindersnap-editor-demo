/** A document using every block the editor makes, for the export tests. */
export const SAMPLE_DOCUMENT = {
  type: "doc",
  attrs: { numberedHeadings: true },
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Infection Control Policy" }],
    },
    { type: "tableOfContents", attrs: { entries: [] } },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Every member of staff follows this policy. It is ",
        },
        {
          type: "text",
          marks: [{ type: "bold" }],
          text: "reviewed every year",
        },
        { type: "text", text: " and signed off by the " },
        {
          type: "text",
          marks: [{ type: "italic" }],
          text: "infection control lead",
        },
        { type: "text", text: " — see " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: "https://www.cdc.gov" } }],
          text: "CDC guidance",
        },
        { type: "text", text: ". H" },
        { type: "text", marks: [{ type: "subscript" }], text: "2" },
        { type: "text", text: "O and 10" },
        { type: "text", marks: [{ type: "superscript" }], text: "th" },
        { type: "text", text: " floor. " },
        {
          type: "text",
          marks: [{ type: "highlight", attrs: { color: "#fef08a" } }],
          text: "Highlighted.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Hand hygiene" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Before and after every patient contact.",
                },
              ],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "After removing gloves." }],
            },
            {
              type: "orderedList",
              attrs: { start: 1 },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "Wash for twenty seconds." },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Checks" }],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Dispensers filled" }],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Audit logged" }],
            },
          ],
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Clean hands save lives." }],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1 },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Area" }],
                },
              ],
            },
            {
              type: "tableHeader",
              attrs: { colspan: 1 },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Frequency" }],
                },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, background: "#dcfce7" },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Wards" }],
                },
              ],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1 },
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Daily, and after every discharge — without exception.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "horizontalRule" },
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [
        {
          type: "text",
          text: "Café staff: naïve → avoid ✓ emoji 😀 and 中文.",
        },
      ],
    },
    { type: "pageBreak" },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Records" }],
    },
    { type: "paragraph" },
    {
      type: "codeBlock",
      content: [{ type: "text", text: "LOG-001\nLOG-002" }],
    },
    {
      type: "paragraph",
      attrs: { indent: 1, lineSpacing: "1.5" },
      content: [
        {
          type: "text",
          marks: [
            {
              type: "textStyle",
              attrs: {
                fontFamily: "Calibri, Carlito, Arial, sans-serif",
                fontSize: "14pt",
                color: "#b91c1c",
              },
            },
          ],
          text: "Set in Calibri at 14pt, indented, one and a half lines apart.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 4 },
      content: [{ type: "text", text: "Signed off by" }],
    },
  ],
};
