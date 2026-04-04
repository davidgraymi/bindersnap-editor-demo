import { test, expect } from "@playwright/test";
import { createBobClient } from "../tests/helpers";

const OWNER = "bindersnap";
const REPO = "system-test";

test("test gitea review submit", async () => {
    const bobClient = await createBobClient();
    
    // Create a pull request as bob using bobClient
    const prBranch = `test/bob-pr-${Date.now()}`;
    await bobClient.POST("/repos/{owner}/{repo}/branches", {
        params: { path: { owner: OWNER, repo: REPO } },
        body: { new_branch_name: prBranch, old_branch_name: "main" }
    });
    await bobClient.POST("/repos/{owner}/{repo}/contents/{filepath}", {
        params: { path: { owner: OWNER, repo: REPO, filepath: `docs/test-${Date.now()}.md` } },
        body: {
            branch: prBranch,
            content: Buffer.from("test").toString("base64"),
            message: "add file"
        }
    });

    const pr = await bobClient.POST("/repos/{owner}/{repo}/pulls", {
        params: { path: { owner: OWNER, repo: REPO } },
        body: { head: prBranch, base: "main", title: "Test PR" }
    });

    const pullNumber = pr.data?.number!;
    console.log("Created PR", pullNumber);

    const pendingReview = await bobClient.POST("/repos/{owner}/{repo}/pulls/{index}/reviews", {
      params: { path: { owner: OWNER, repo: REPO, index: pullNumber } },
      body: { body: "Test body" },
    });
    
    if (pendingReview.data) {
        console.log("pending review ID", pendingReview.data.id);
        const res = await bobClient.POST("/repos/{owner}/{repo}/pulls/{index}/reviews/{id}", {
            params: { path: { owner: OWNER, repo: REPO, index: pullNumber, id: pendingReview.data.id } },
            body: { event: "APPROVED", body: "Approved by integration test." },
        });
        console.log("Submit res with APPROVED:", res.response.status, res.data, res.error);
        
        const res2 = await bobClient.POST("/repos/{owner}/{repo}/pulls/{index}/reviews/{id}", {
            params: { path: { owner: OWNER, repo: REPO, index: pullNumber, id: pendingReview.data.id } },
            body: { event: "APPROVE", body: "Approved by integration test." },
        });
        console.log("Submit res with APPROVE:", res2.response.status, res2.data, res2.error);
    }
});
