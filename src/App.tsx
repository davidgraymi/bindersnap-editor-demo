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
    <>
      <nav
        className="navbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "15px 40px",
          alignItems: "center",
          backgroundColor: "#fff",
          borderBottom: "1px solid #e0e0e0",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div className="navbar-left">
          <a
            href="#"
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              textDecoration: "none",
              color: "#1976d2",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <img
              src="./logo.svg"
              alt="Bindersnap Logo"
              style={{ height: "32px" }}
            />
            Bindersnap
          </a>
        </div>
        <div
          className="navbar-right"
          style={{ display: "flex", gap: "20px", alignItems: "center" }}
        >
          <a
            href="#"
            style={{ textDecoration: "none", color: "#333", fontWeight: 500 }}
          >
            Help
          </a>
          <a
            href="#"
            style={{ textDecoration: "none", color: "#333", fontWeight: 500 }}
          >
            Sign in
          </a>
          <a
            href="#"
            style={{
              textDecoration: "none",
              backgroundColor: "#1976d2",
              color: "#fff",
              padding: "8px 16px",
              borderRadius: "4px",
              fontWeight: 600,
            }}
          >
            Sign up
          </a>
        </div>
      </nav>

      <div role="main" aria-label="home" className="home">
        <div className="landing-intro"></div>
        <div
          className="ui center aligned container hero"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <h1 className="ui header">
            Replace shared drives with a single, collaborative platform.
          </h1>
          <h2>
            Join the headache free, all-in-one document management platform.
          </h2>

          <div
            className="editor-demo-container"
            style={{
              marginTop: "3em",
              marginBottom: "3em",
              textAlign: "left",
              zIndex: 10,
            }}
          >
            <DemoEditor
              initialContent={sampleJson}
              onChange={handleChange}
              placeholder="Start typing your document..."
            />
          </div>
        </div>

        <div className="landing-benefits">
          <div className="landing-benefits-item item-1">
            <div className="landing-benefits-left">
              <h3>Securely store your documents</h3>
              <p>
                Every document is tracked, creating a tamper-proof audit trail
                to support legal compliance and protect your work.
              </p>
            </div>
            <div className="landing-benefits-right">
              <img src="#" alt="logo" aria-hidden="true" />
            </div>
          </div>
          <div className="landing-benefits-item item-2">
            <div className="landing-benefits-left">
              <h3>Work from anywhere</h3>
              <p>
                Access and edit documents from any browser. No installs, no
                compatibility issues, no excuses.
              </p>
            </div>
            <div className="landing-benefits-right">
              <img src="#" alt="logo" aria-hidden="true" />
            </div>
          </div>
          <div className="landing-benefits-item item-3">
            <div className="landing-benefits-left">
              <h3>Collaborate effortlessly</h3>
              <p>
                Discuss changes, ask questions, and make decisions without
                leaving the platform — no extra tools or lost context.
              </p>
            </div>
            <div className="landing-benefits-right">
              <img src="#" alt="logo" aria-hidden="true" />
            </div>
          </div>
          <div className="landing-benefits-item item-4">
            <div className="landing-benefits-left">
              <h3>Streamline reviews</h3>
              <p>
                Enforce approvals, catch issues early, and eliminate bottlenecks
                — without endless back-and-forth emails.
              </p>
            </div>
            <div className="landing-benefits-right">
              <img src="#" alt="logo" aria-hidden="true" />
            </div>
          </div>
          <div className="landing-benefits-item item-5">
            <div className="landing-benefits-left">
              <h3>Meet deadlines</h3>
              <p>
                Create issues, assign tasks, resolve blockers and never lose
                sight of your goals with projects.
              </p>
            </div>
            <div className="landing-benefits-right">
              <img src="#" alt="logo" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div className="landing-price">
          <h1>Find the right plan for your business.</h1>
          <h2>Choose the Bindersnap plan that best fits your business.</h2>
          <div className="landing-price-tiers">
            <div className="tier-container-free">
              <h3>Free</h3>
              <div className="landing-price-row">
                <div className="landing-price-bold-text">$0</div>
                <div className="landing-price-info-text">per user/month</div>
              </div>
              <div className="tier-spacer"></div>
              <div className="landing-price-feature-label">
                Features include:
              </div>
              <div className="landing-price-feature">
                5 public/private repositories
              </div>
              <div className="landing-price-feature">issues and milestones</div>
              <div className="landing-price-feature">
                50MB of storage per repo
              </div>
            </div>
            <div className="tier-container-premium">
              <h3>Premium</h3>
              <div className="landing-price-row">
                <div className="landing-inner-price-row">
                  <span className="landing-price-bold-old-text">$15</span>
                  <span className="landing-price-bold-text">$5</span>
                </div>
                <div className="landing-price-info-text">
                  per user / month,
                  <br />
                  billed annually
                </div>
              </div>
              <div className="tier-spacer"></div>
              <div className="landing-price-feature-label">
                Everything from Free, plus:
              </div>
              <div className="landing-price-feature">
                unlimited repositories
              </div>
              <div className="landing-price-feature">project management</div>
              <div className="landing-price-feature">multiple reviewers</div>
              <div className="landing-price-feature">required reviewers</div>
              <div className="landing-price-feature">draft change requests</div>
              <div className="landing-price-feature">protected branches</div>
              <div className="landing-price-feature">wikis</div>
              <div className="landing-price-feature">
                5GiB of storage per repo
              </div>
            </div>
            <div className="tier-container-ultimate">
              <h3>Ultimate</h3>
              <div className="landing-price-row-pad">
                <div className="landing-price-talk-text">
                  Talk to sales for pricing
                </div>
              </div>
              <div className="tier-spacer"></div>
              <div className="landing-price-feature-label">
                Everything from Premium, plus:
              </div>
              <div className="landing-price-feature">data residence</div>
              <div className="landing-price-feature">
                enterprise managed users
              </div>
              <div className="landing-price-feature">
                user provisioning through SCIM
              </div>
              <div className="landing-price-feature">SAML single sign-on</div>
              <div className="landing-price-feature">
                white glove onboarding
              </div>
            </div>
          </div>
        </div>

        <div className="outro">
          <div
            className="ui center aligned container alternative-cta"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              width: "100%",
            }}
          >
            <h1 className="ui header">
              Deliver better work, without the chaos.
            </h1>
            <h2>
              See what your team can do with the intelligent document platform.
            </h2>
            <div className="landing-cta-container">
              <div className="landing-cta-input-container">
                <input
                  className="landing-email"
                  type="email"
                  id="email"
                  name="user_email"
                  size={50}
                  placeholder="Enter your email"
                />
                <button className="ui button cta">
                  <span>Sign up for Bindersnap</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <footer className="page-footer">
        <div className="left-links">
          <a href="#" style={{ textDecoration: "none", color: "inherit" }}>
            © 2026 Bindersnap
          </a>
          <a href="#" style={{ textDecoration: "none", color: "inherit" }}>
            Terms of Service
          </a>
          <a href="#" style={{ textDecoration: "none", color: "inherit" }}>
            Privacy Policy
          </a>
        </div>
        <div className="right-links">
          <a href="#" style={{ textDecoration: "none", color: "inherit" }}>
            Language
          </a>
          <a href="#" style={{ textDecoration: "none", color: "inherit" }}>
            Help
          </a>
        </div>
      </footer>
    </>
  );
}

export default App;
