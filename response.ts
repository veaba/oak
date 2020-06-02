// Copyright 2018-2020 the oak authors. All rights reserved. MIT license.

import { contentType, Status } from "./deps.ts";
import { Request } from "./request.ts";
import { isHtml, isRedirectStatus, encodeUrl } from "./util.ts";

interface ServerResponse {
  status?: number;
  headers?: Headers;
  body?: Uint8Array | Deno.Reader;
}

export const REDIRECT_BACK = Symbol("redirect backwards");

const BODY_TYPES = ["string", "number", "bigint", "boolean", "symbol"];

const encoder = new TextEncoder();

/** Guard for `Deno.Reader`. */
function isReader(value: any): value is Deno.Reader {
  return typeof value === "object" && "read" in value &&
    typeof value.read === "function";
}

export class Response {
  #body?: any;
  #headers = new Headers();
  #request: Request;
  #serverResponse?: ServerResponse;
  #status?: Status;
  #type?: string;
  #writable = true;

  #getBody = (): Uint8Array | Deno.Reader | undefined => {
    const typeofBody = typeof this.body;
    let result: Uint8Array | Deno.Reader | undefined;
    if (BODY_TYPES.includes(typeofBody)) {
      const bodyText = String(this.body);
      result = encoder.encode(bodyText);
      this.type = this.type || (isHtml(bodyText) ? "html" : "text/plain");
    } else if (this.body instanceof Uint8Array || isReader(this.body)) {
      result = this.body;
    } else if (this.body && typeofBody === "object") {
      result = encoder.encode(JSON.stringify(this.body));
      this.type = this.type || "json";
    } else if (this.body) {
      throw new TypeError("Response body was set, but could not convert");
    }
    return result;
  };

  #setContentType = (): void => {
    if (this.type) {
      const contentTypeString = contentType(this.type);
      if (contentTypeString && !this.headers.has("Content-Type")) {
        this.headers.append("Content-Type", contentTypeString);
      }
    }
  };

  /** The body of the response.  The body will be automatically processed when
   * the response is being sent and converted to a `Uint8Array` or a
   * `Deno.Reader`. */
  get body(): any {
    return this.#body;
  }

  /** The body of the response.  The body will be automatically processed when
   * the response is being sent and converted to a `Uint8Array` or a
   * `Deno.Reader`. */
  set body(value: any) {
    if (!this.#writable) {
      throw new Error("The response is not writable.");
    }
    this.#body = value;
  }

  /** Headers that will be returned in the response. */
  get headers(): Headers {
    return this.#headers;
  }

  /** Headers that will be returned in the response. */
  set headers(value: Headers) {
    if (!this.#writable) {
      throw new Error("The response is not writable.");
    }
    this.#headers = value;
  }

  /** The HTTP status of the response.  If this has not been explicitly set,
   * reading the value will return what would be the value of status if the
   * response were sent at this point in processing the middleware.  If the body
   * has been set, the status will be `200 OK`.  If a value for the body has
   * not been set yet, the status will be `404 Not Found`. */
  get status(): Status {
    if (this.#status) {
      return this.#status;
    }
    const typeofbody = typeof this.body;
    return this.body &&
      (BODY_TYPES.includes(typeofbody) || typeofbody === "object")
      ? Status.OK
      : Status.NotFound;
  }

  /** The HTTP status of the response.  If this has not been explicitly set,
   * reading the value will return what would be the value of status if the
   * response were sent at this point in processing the middleware.  If the body
   * has been set, the status will be `200 OK`.  If a value for the body has
   * not been set yet, the status will be `404 Not Found`. */
  set status(value: Status) {
    if (!this.#writable) {
      throw new Error("The response is not writable.");
    }
    this.#status = value;
  }

  /** The media type, or extension of the response.  Setting this value will
   * ensure an appropriate `Content-Type` header is added to the response. */
  get type(): string | undefined {
    return this.#type;
  }
  set type(value: string | undefined) {
    if (!this.#writable) {
      throw new Error("The response is not writable.");
    }
    this.#type = value;
  }

  /** A read-only property which determines if the response is writable or not.
   * Once the response has been processed, this value is set to `false`. */
  get writable(): boolean {
    return this.#writable;
  }

  constructor(request: Request) {
    this.#request = request;
  }

  /** Sets the response to redirect to the supplied `url`.
   *
   * If the `.status` is not currently a redirect status, the status will be set
   * to `302 Found`.
   *
   * The body will be set to a message indicating the redirection is occurring.
   */
  redirect(url: string | URL): void;
  /** Sets the response to redirect back to the referrer if available, with an
   * optional `alt` URL if there is no referrer header on the request.  If there
   * is no referrer header, nor an `alt` parameter, the redirect is set to `/`.
   *
   * If the `.status` is not currently a redirect status, the status will be set
   * to `302 Found`.
   *
   * The body will be set to a message indicating the redirection is occurring.
   */
  redirect(url: typeof REDIRECT_BACK, alt?: string | URL): void;
  redirect(
    url: string | URL | typeof REDIRECT_BACK,
    alt: string | URL = "/",
  ): void {
    if (url === REDIRECT_BACK) {
      url = this.#request.headers.get("Referrer") ?? String(alt);
    } else if (typeof url === "object") {
      url = String(url);
    }
    this.headers.set("Location", encodeUrl(url));
    if (!this.status || !isRedirectStatus(this.status)) {
      this.status = Status.Found;
    }

    if (this.#request.accepts("html")) {
      url = encodeURI(url);
      this.type = "text/html; charset=utf-8";
      this.body = `Redirecting to <a href="${url}">${url}</a>.`;
      return;
    }
    this.type = "text/plain; charset=utf-8";
    this.body = `Redirecting to ${url}.`;
  }

  /** Take this response and convert it to the response used by the Deno net
   * server.  Calling this will set the response to not be writable. */
  toServerResponse(): ServerResponse {
    if (this.#serverResponse) {
      return this.#serverResponse;
    }
    // Process the body
    const body = this.#getBody();

    // If there is a response type, set the content type header
    this.#setContentType();

    const { headers } = this;

    // If there is no body and no content type and no set length, then set the
    // content length to 0
    if (
      !(
        body ||
        headers.has("Content-Type") ||
        headers.has("Content-Length")
      )
    ) {
      headers.append("Content-Length", "0");
    }

    this.#writable = false;
    return this.#serverResponse = {
      status: this.#status ?? (body ? Status.OK : Status.NotFound),
      body,
      headers,
    };
  }
}
