import { useState } from "react";
import type { Content } from "@tiptap/react";

import { DemoEditor } from "./components/Editor";
import { gitService } from "./services/GitService";

import "./index.css";

const sampleJson = {
  type: "doc",
  content: [
    {
      type: "conflict",
      attrs: {
        conflictId: 1,
        ourContent: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Current Change (Ours)" }],
          },
        ],
        theirContent: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "This is the " },
              {
                type: "text",
                marks: [{ type: "bold" }],
                text: "incoming change",
              },
              { type: "text", text: " from the other branch with " },
              {
                type: "text",
                marks: [{ type: "italic" }],
                text: "different formatting",
              },
              { type: "text", text: "." },
            ],
          },
        ],
        baseContent: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Base Content" }],
          },
        ],
        ourBranch: "main",
        theirBranch: "feature/update",
        baseBranch: "main",
        ourCommitHash: "our123",
        theirCommitHash: "their456",
        baseCommitHash: "base789",
        resolved: false,
        acceptedBranch: null,
      },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Current Change (Ours)" }],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        textAlign: null,
        level: 1,
      },
      content: [
        {
          type: "text",
          text: "Welcome to the Rich Text Editor",
        },
      ],
    },
    {
      type: "conflict",
      attrs: {
        conflictId: 1,
        ourContent: [],
        theirContent: [
          {
            type: "heading",
            attrs: {
              textAlign: null,
              level: 1,
            },
            content: [
              {
                type: "text",
                text: "Welcome to the Rich Text Editor",
              },
            ],
          },
        ],
        baseContent: [
          {
            type: "heading",
            attrs: {
              textAlign: null,
              level: 1,
            },
            content: [
              {
                type: "text",
                text: "Welcome to the Bindersnap Editor",
              },
            ],
          },
        ],
        ourBranch: "main",
        theirBranch: "feature/update",
        baseBranch: "main",
        ourCommitHash: "our123",
        theirCommitHash: "their456",
        baseCommitHash: "base789",
        resolved: false,
        acceptedBranch: null,
      },
      content: [],
    },
    {
      type: "paragraph",
      attrs: {
        textAlign: null,
      },
      content: [
        {
          type: "text",
          text: "This is a complete ",
        },
        {
          type: "text",
          marks: [
            {
              type: "bold",
            },
          ],
          text: "TipTap",
        },
        {
          type: "text",
          text: " editor with a ",
        },
        {
          type: "text",
          marks: [
            {
              type: "italic",
            },
          ],
          text: "Microsoft Word-like",
        },
        {
          type: "text",
          text: " toolbar. Try out all the formatting options!",
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        textAlign: null,
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Features",
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "bold",
                    },
                  ],
                  text: "Text Formatting",
                },
                {
                  type: "text",
                  text: ": Bold, italic, underline, strikethrough, subscript, and superscript",
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
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "bold",
                    },
                  ],
                  text: "Font Options",
                },
                {
                  type: "text",
                  text: ": Choose from multiple font families and sizes",
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
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "bold",
                    },
                  ],
                  text: "Colors",
                },
                {
                  type: "text",
                  text: ": Add text color and highlight to your content",
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
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "bold",
                    },
                  ],
                  text: "Alignment",
                },
                {
                  type: "text",
                  text: ": Left, center, right, and justify alignment",
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
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "bold",
                    },
                  ],
                  text: "Lists",
                },
                {
                  type: "text",
                  text: ": Bullet lists, numbered lists, and checklists",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        textAlign: null,
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Code Example",
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: {
        language: null,
      },
      content: [
        {
          type: "text",
          text: "function greet(name) {\n  return `Hello, ${name}!`;\n}",
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        textAlign: null,
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Blockquote",
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          attrs: {
            textAlign: null,
          },
          content: [
            {
              type: "text",
              text: '"The only way to do great work is to love what you do." — Steve Jobs',
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        textAlign: null,
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Task List",
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {
            checked: true,
          },
          content: [
            {
              type: "paragraph",
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  text: "Complete the editor demo",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  text: "Add more features",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              attrs: {
                textAlign: null,
              },
              content: [
                {
                  type: "text",
                  text: "Write documentation",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      attrs: {
        textAlign: null,
      },
      content: [
        {
          type: "text",
          text: "Start editing to see the changes in real-time!",
        },
      ],
    },
  ],
};

export function App() {
  const [content, setContent] = useState<Content>(() => {
    const history = gitService.getHistory();
    if (history.length > 0) {
      // Use the content of the latest commit (HEAD)
      const head = history[0];
      if (head) return head.content;
    }
    return sampleJson;
  });

  const handleChange = (content: Content) => {
    setContent(content);
  };

  return (
    <div className="app">
      <div className="app-header">
        <h1>Rich Text Editor Demo</h1>
        <p>A TipTap-powered editor with Google Docs-like features</p>
      </div>

      <div className="editor-demo-container">
        <DemoEditor
          initialContent={sampleJson}
          onChange={handleChange}
          placeholder="Start typing your document..."
        />
      </div>
    </div>
  );
}

export default App;
