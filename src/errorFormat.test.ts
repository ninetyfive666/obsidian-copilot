import { ChatModelProviders } from "@/constants";
import { err2String, withV1BaseHint } from "./errorFormat";

describe("errorFormat", () => {
  describe("withV1BaseHint()", () => {
    it("appends the /v1 Base URL hint to a 404 from an OpenAI-format endpoint", () => {
      const out = withV1BaseHint("404 404 page not found", {
        provider: ChatModelProviders.OPENAI_FORMAT,
        baseUrl: "http://llm.home",
      });
      expect(out).toBe(
        "404 404 page not found" +
          "\nHint: the server answered 404. If it serves the OpenAI API under /v1, " +
          "set the Base URL to http://llm.home/v1."
      );
    });

    it("strips a trailing slash before appending /v1", () => {
      const out = withV1BaseHint("HTTP 404", {
        provider: ChatModelProviders.OPENAI_FORMAT,
        baseUrl: "http://llm.home:8080/",
      });
      expect(out).toContain("http://llm.home:8080/v1");
    });

    it("leaves the message alone when the Base URL already carries /v1", () => {
      const message = "404 page not found";
      const out = withV1BaseHint(message, {
        provider: ChatModelProviders.OPENAI_FORMAT,
        baseUrl: "http://llm.home/v1",
      });
      expect(out).toBe(message);
    });

    it("leaves the message alone for non-OpenAI-format providers", () => {
      const message = "404 page not found";
      const out = withV1BaseHint(message, { provider: "ollama", baseUrl: "http://llm.home" });
      expect(out).toBe(message);
    });

    it("leaves the message alone when it does not report a 404", () => {
      const message = "Request failed, status 500";
      const out = withV1BaseHint(message, {
        provider: ChatModelProviders.OPENAI_FORMAT,
        baseUrl: "http://llm.home",
      });
      expect(out).toBe(message);
    });

    it("leaves the message alone when no model is known", () => {
      const message = "404 page not found";
      expect(withV1BaseHint(message, null)).toBe(message);
      expect(withV1BaseHint(message, undefined)).toBe(message);
      expect(withV1BaseHint(message, {})).toBe(message);
    });
  });

  describe("err2String()", () => {
    it("renders the message of an Error", () => {
      expect(err2String(new Error("boom"))).toBe("boom");
    });

    it("appends the cause message when the Error carries one", () => {
      const error = new Error("outer");
      (error as { cause?: unknown }).cause = new Error("inner");
      expect(err2String(error)).toBe("outer\nmore message: inner");
    });
  });
});
