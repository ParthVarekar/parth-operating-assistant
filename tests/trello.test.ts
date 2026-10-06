import { beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../src/db/database.js";
import { setUserProfile } from "../src/db/repositories/habitRepository.js";
import {
  formatTrelloStatusDigest,
  getTrelloAccessToken,
} from "../src/services/trelloService.js";

describe("Trello Service Suite", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = ":memory:";
    initDatabase(":memory:");
  });

  it("reports disconnected digest when no token is present", async () => {
    delete process.env.TRELLO_ACCESS_TOKEN;
    const digest = await formatTrelloStatusDigest();
    expect(digest).toContain("Trello Connectivity: Disconnected");
    expect(digest).toContain("npm run auth:trello");
  });

  it("retrieves token stored in user_profile", () => {
    setUserProfile("trello_access_token", "mock_oauth_access_token_123");
    const token = getTrelloAccessToken();
    expect(token).toBe("mock_oauth_access_token_123");
  });
});
