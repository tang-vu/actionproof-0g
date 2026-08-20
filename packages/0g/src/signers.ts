import {
  actionAttestationTypes,
  actionProofDomain,
  toTypedAttestation,
  type Attestation,
} from "@actionproof/core";
import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { z } from "zod";

export interface AttestationSigner {
  readonly address: Address;
  sign(attestation: Attestation, chainId: number, guardAddress: Address): Promise<Hex>;
}

export class LocalAttestationSigner implements AttestationSigner {
  readonly address: Address;
  readonly #account: LocalAccount;

  constructor(account: LocalAccount) {
    this.#account = account;
    this.address = getAddress(account.address);
  }

  sign(attestation: Attestation, chainId: number, guardAddress: Address): Promise<Hex> {
    return this.#account.signTypedData({
      domain: actionProofDomain(chainId, guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: toTypedAttestation(attestation),
    });
  }
}

const remoteSignatureSchema = z.object({ signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/u) });
const remoteHealthSchema = z.object({ ok: z.literal(true), address: z.string() });

export class RemoteAttestationSigner implements AttestationSigner {
  readonly address: Address;
  readonly #endpoint: URL;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(args: {
    address: Address;
    endpoint: string;
    token: string;
    timeoutMs?: number;
    fetchFn?: typeof fetch;
  }) {
    const endpoint = new URL(args.endpoint);
    if (endpoint.protocol !== "https:")
      throw new TypeError("Remote signer endpoint must use HTTPS");
    this.address = getAddress(args.address);
    this.#endpoint = endpoint;
    this.#token = args.token;
    this.#timeoutMs = args.timeoutMs ?? 10_000;
    this.#fetch = args.fetchFn ?? fetch;
  }

  async sign(attestation: Attestation, chainId: number, guardAddress: Address): Promise<Hex> {
    const domain = actionProofDomain(chainId, guardAddress);
    const message = toTypedAttestation(attestation);
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        {
          version: "actionproof-remote-signer/1",
          domain,
          types: actionAttestationTypes,
          primaryType: "ActionAttestation",
          message,
        },
        (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
      ),
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`Remote signer returned HTTP ${response.status}`);
    const { signature } = remoteSignatureSchema.parse(await response.json());
    const recovered = await recoverTypedDataAddress({
      domain,
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message,
      signature: signature as Hex,
    });
    if (recovered.toLowerCase() !== this.address.toLowerCase()) {
      throw new Error(`Remote signer recovered ${recovered}, expected ${this.address}`);
    }
    return signature as Hex;
  }

  async health(): Promise<void> {
    const response = await this.#fetch(this.#endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${this.#token}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`Remote signer health returned HTTP ${response.status}`);
    const health = remoteHealthSchema.parse(await response.json());
    if (getAddress(health.address) !== this.address) {
      throw new Error(`Remote signer health reported ${health.address}, expected ${this.address}`);
    }
  }
}
