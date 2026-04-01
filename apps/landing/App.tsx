import { useState } from "react";
import type { Content } from "@tiptap/react";

import { DemoEditor } from "../../packages/editor/Editor";
import { gitService } from "../../packages/editor/services/GitService";
import type { CommentThread } from "../../packages/editor/sidebar/CommentSidebar";

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
        conflictId: 2,
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

type DemoPersistedComment = {
  gitea: {
    id: number;
    body: string;
    created_at: string;
    path: string;
    position: number;
    original_position: number;
    user: {
      login: string;
    };
  };
  anchor: {
    from: number;
    to: number;
  };
  resolved?: boolean;
};

const demoPersistedComments: DemoPersistedComment[] = [
  {
    gitea: {
      id: 101,
      body: "This reads like the kind of paragraph reviewers usually question first.",
      created_at: "2026-03-30T09:15:00Z",
      path: "docs/contract.json",
      position: 14,
      original_position: 14,
      user: { login: "ava.chen" },
    },
    anchor: { from: 157, to: 163 },
  },
  {
    gitea: {
      id: 102,
      body: "Keep the heading clear here. This is the part stakeholders will quote back.",
      created_at: "2026-03-30T09:58:00Z",
      path: "docs/contract.json",
      position: 8,
      original_position: 8,
      user: { login: "jordan.lee" },
    },
    anchor: { from: 81, to: 113 },
  },
];

const sampleComments: CommentThread[] = demoPersistedComments.map(
  ({ gitea, anchor, resolved }) => ({
    id: String(gitea.id),
    author: gitea.user.login,
    createdAt: new Date(gitea.created_at).toLocaleString(),
    body: gitea.body,
    resolved: resolved ?? false,
    anchor,
    source: {
      path: gitea.path,
      position: gitea.position,
      originalPosition: gitea.original_position,
    },
  }),
);

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
    <DemoEditor
      initialContent={sampleJson}
      onChange={handleChange}
      placeholder="Start typing your document..."
      comments={sampleComments}
    />
  );
}

export default App;
