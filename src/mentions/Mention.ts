import { ImageProcessor } from "@/imageProcessing/imageProcessor";
import { Vault } from "obsidian";
import { isTwitterUrl, isYoutubeUrl } from "@/utils";

export interface MentionData {
  type: string;
  original: string;
  processed?: string;
  error?: string;
}

const UNSUPPORTED_URL_ERROR =
  "URL content cannot be fetched: this build only works with local content.";
const UNSUPPORTED_YOUTUBE_ERROR =
  "YouTube transcripts cannot be fetched: this build only works with local content.";
const UNSUPPORTED_TWITTER_ERROR =
  "Twitter content cannot be fetched: this build only works with local content.";

export class Mention {
  private static instance: Mention;
  private mentions: Map<string, MentionData>;

  private constructor() {
    this.mentions = new Map();
  }

  static getInstance(): Mention {
    if (!Mention.instance) {
      Mention.instance = new Mention();
    }
    return Mention.instance;
  }

  async processUrl(url: string): Promise<{ response: string; elapsed_time_ms: number; error?: string }> {
    return { response: url, elapsed_time_ms: 0, error: UNSUPPORTED_URL_ERROR };
  }

  async processYoutubeUrl(url: string): Promise<{ transcript: string; error?: string }> {
    return { transcript: "", error: UNSUPPORTED_YOUTUBE_ERROR };
  }

  async processTwitterUrl(url: string): Promise<{
    response: string;
    elapsed_time_ms: number;
    error?: string;
  }> {
    return { response: url, elapsed_time_ms: 0, error: UNSUPPORTED_TWITTER_ERROR };
  }

  async processUrlList(
    vault: Vault,
    urls: string[]
  ): Promise<{
    urlContext: string;
    imageUrls: string[];
    processedErrorUrls: Record<string, string>;
  }> {
    let urlContext = "";
    const imageUrls: string[] = [];
    const processedErrorUrls: Record<string, string> = {};

    if (urls.length === 0) {
      return { urlContext, imageUrls, processedErrorUrls };
    }

    for (const url of urls) {
      if (await ImageProcessor.isImageUrl(url, vault)) {
        imageUrls.push(url);
        continue;
      }

      const data: MentionData = isYoutubeUrl(url)
        ? {
            type: "youtube",
            original: url,
            processed: "",
            error: UNSUPPORTED_YOUTUBE_ERROR,
          }
        : isTwitterUrl(url)
          ? {
              type: "twitter",
              original: url,
              processed: url,
              error: UNSUPPORTED_TWITTER_ERROR,
            }
          : {
              type: "url",
              original: url,
              processed: url,
              error: UNSUPPORTED_URL_ERROR,
            };

      if (data.error) {
        processedErrorUrls[data.original] = data.error;
      }
    }

    return { urlContext, imageUrls, processedErrorUrls };
  }
}
