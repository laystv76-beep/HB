import { describe, expect, it } from "vitest";

describe("Expo build credentials", () => {
  it("authenticates with Expo GraphQL without exposing the token", async () => {
    const token = process.env.EXPO_TOKEN;
    expect(token, "EXPO_TOKEN must be configured").toBeTruthy();

    const response = await fetch("https://api.expo.dev/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "query CurrentUser { meActor { __typename id } }" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { meActor?: { id?: string } }; errors?: unknown[] };
    expect(body.errors).toBeUndefined();
    expect(body.data?.meActor?.id).toBeTruthy();
  }, 20_000);
});
