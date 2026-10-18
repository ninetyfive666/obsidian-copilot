import { CanvasLoader } from "../../src/tools/CanvasLoader";
jest.mock("../../src/tools/CanvasLoader", () => ({
  CanvasLoader: jest.fn().mockImplementation(() => ({ load: jest.fn(async () => ({})), buildPrompt: jest.fn(() => "canvas prompt") })),
}));
it("dbg instances", () => {
  const loader = new CanvasLoader({} as never);
  const m = CanvasLoader as unknown as jest.Mock;
  // eslint-disable-next-line no-console
  console.log("loader:", typeof loader, "instances:", m.mock.instances.length);
});
