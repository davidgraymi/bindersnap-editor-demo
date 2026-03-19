# Automated Development Orchestration

This project uses a Claude Code multi-agent pipeline to autonomously implement GitHub Issues while you're away. Claude Opus acts as the orchestrator (planning, delegation, QA), while Claude Sonnet subagents do the actual implementation, testing, and review work. Completed work is submitted as a Pull Request for your review.

---

## How It Works

```
launchd (Mac mini schedule)
  └── orchestrate.sh
        └── Claude Opus (orchestrator)
              ├── issue-fetcher  → claims next GitHub issue
              ├── implementer    → writes the code
              ├── tester         → writes & runs tests
              └── reviewer       → QA gate before PR
```

1. The scheduler triggers `orchestrate.sh` on your Mac mini at configured times
2. Opus claims the next issue labeled `ready` from GitHub
3. Sonnet subagents implement, test, and review in sequence
4. If all checks pass, Opus opens a Pull Request and you review when available
5. If agents get stuck after retries, the issue is labeled `blocked` with a comment explaining why

---

## Prerequisites

Install the following on your Mac mini before setup:

| Tool            | Install                                    | Verify             |
| --------------- | ------------------------------------------ | ------------------ |
| Node.js 18+     | [nodejs.org](https://nodejs.org)           | `node --version`   |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| GitHub CLI      | `brew install gh`                          | `gh --version`     |
| Git             | Built-in / Xcode tools                     | `git --version`    |

Authenticate both CLIs:

```bash
claude auth login
gh auth login
```

---

## Environment Variables

All configuration lives in `~/.claude-dev.env` on your Mac mini. This file is **never committed to git**.

### Setup

```bash
# Copy the example file
cp scripts/claude-dev.env.example ~/.claude-dev.env

# Open and fill in your values
nano ~/.claude-dev.env
```

### Required Variables

| Variable                        | Description                            | Example                           |
| ------------------------------- | -------------------------------------- | --------------------------------- |
| `CLAUDE_DEV_PROJECT_DIR`        | Absolute path to your local repo       | `/Users/yourname/projects/my-app` |
| `CLAUDE_DEV_BASE_BRANCH`        | Git branch agents base work off of     | `main`                            |
| `CLAUDE_DEV_LOG_DIR`            | Where session logs are written         | `/Users/yourname/claude-logs`     |
| `CLAUDE_DEV_ORCHESTRATOR_MODEL` | Claude model for Opus orchestrator     | `claude-opus-4-5`                 |
| `CLAUDE_DEV_AGENT_MODEL`        | Claude model for Sonnet subagents      | `claude-sonnet-4-5`               |
| `CLAUDE_DEV_GITHUB_REPO`        | GitHub repo in `owner/repo` format     | `yourname/your-repo`              |
| `CLAUDE_DEV_LABEL_READY`        | Label marking issues ready for agents  | `ready`                           |
| `CLAUDE_DEV_LABEL_IN_PROGRESS`  | Label applied when an issue is claimed | `in-progress`                     |
| `CLAUDE_DEV_LABEL_PR_OPEN`      | Label applied after a PR is opened     | `pr-open`                         |
| `CLAUDE_DEV_LABEL_BLOCKED`      | Label applied when agents are stuck    | `blocked`                         |
| `CLAUDE_DEV_MAX_FIX_CYCLES`     | Max implement→test retry loops         | `3`                               |
| `CLAUDE_DEV_MAX_REVIEW_CYCLES`  | Max implement→review retry loops       | `2`                               |

### Optional Variables

| Variable              | Description                              | Default             |
| --------------------- | ---------------------------------------- | ------------------- |
| `CLAUDE_DEV_ENV_FILE` | Override env file path (used by launchd) | `~/.claude-dev.env` |

---

## One-Time GitHub Setup

Create the required labels in your repository:

```bash
gh label create "ready"       --color 0075ca --description "Ready for agents to pick up"
gh label create "in-progress" --color e4e669 --description "Currently being worked on by an agent"
gh label create "pr-open"     --color d93f0b --description "Agent opened a PR — needs human review"
gh label create "blocked"     --color b60205 --description "Agent could not complete — needs human"
```

---

## Mac Mini Setup

### 1. Clone the repo and make scripts executable

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git ~/projects/your-project
chmod +x ~/projects/your-project/scripts/orchestrate.sh
```

### 2. Install the environment file

```bash
cp ~/projects/your-project/scripts/claude-dev.env.example ~/.claude-dev.env
# Edit with your actual values:
nano ~/.claude-dev.env
```

### 3. Install the launchd schedule

```bash
# Copy the plist — replace YOUR_USERNAME with output of: whoami
cp launchd/com.claudedev.orchestrator.plist ~/Library/LaunchAgents/

# Open it and replace all YOUR_USERNAME placeholders
nano ~/Library/LaunchAgents/com.claudedev.orchestrator.plist

# Load it into launchd
launchctl load ~/Library/LaunchAgents/com.claudedev.orchestrator.plist
```

### 4. Prevent your Mac mini from sleeping

System Settings → Energy → set "Prevent automatic sleeping when the display is off" to **On**.

### 5. Test a manual run

```bash
bash ~/projects/your-project/scripts/orchestrate.sh
```

Check `~/claude-logs/sessions.log` to confirm it ran.

---

## Triggering a Run Manually

```bash
# Run immediately (useful for testing)
launchctl start com.claudedev.orchestrator

# Or run the script directly
bash ~/projects/your-project/scripts/orchestrate.sh
```

---

## Monitoring

| What to check         | How                                                           |
| --------------------- | ------------------------------------------------------------- |
| Session history       | `cat ~/claude-logs/sessions.log`                              |
| Latest session detail | `ls -lt ~/claude-logs/*.json \| head -1` then `cat` that file |
| launchd errors        | `cat ~/claude-logs/launchd-error.log`                         |
| Issues in progress    | `gh issue list --label "in-progress"`                         |
| Blocked issues        | `gh issue list --label "blocked"`                             |
| Open PRs from agents  | `gh pr list`                                                  |

---

## Your Daily Workflow

You only need ~10 minutes when you're free:

1. **Merge or review PRs** — `gh pr list` shows everything agents opened
2. **Unblock stuck issues** — check `blocked` issues, leave a clarifying comment, re-label as `ready`
3. **Queue new work** — label decomposed issues as `ready` to feed the next session

---

## Uninstalling

```bash
launchctl unload ~/Library/LaunchAgents/com.claudedev.orchestrator.plist
rm ~/Library/LaunchAgents/com.claudedev.orchestrator.plist
rm ~/.claude-dev.env
```
