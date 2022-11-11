import {
  defaultAbiCoder,
  namehash,
  sha256,
  verifyTypedData,
} from "ethers/lib/utils";
import { makeResponse } from "./helpers";
import { AvatarUploadParams, Env } from "./types";

const _handleFetch =
  (endpoint: string) =>
  async (
    to: string,
    data: string
  ): Promise<{
    jsonrpc: string;
    result: string;
    id: number;
  }> => {
    console.log(`to: ${JSON.stringify(to)}`)
    console.log(`data: ${JSON.stringify(data)}`)
    console.log(`endpoint: ${endpoint}`)
    return await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            to,
            data,
          },
          "latest",
        ],
        id: 1,
      }),
    }).then((res) => res.json());
  };

const dataURLToBytes = (dataURL: string) => {
  const base64 = dataURL.split(",")[1];
  const mime = dataURL.split(",")[0].split(":")[1].split(";")[0];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { mime, bytes };
};

export default async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  name: string,
  network: string
): Promise<Response> => {
    console.log('we are putting')
//   const handleFetch = _handleFetch(env.BASE_WEB3_ENDPOINT + "/" + network);
  const handleFetch = _handleFetch(env.BASE_WEB3_ENDPOINT);
  const { expiry, dataURL, sig } = (await request.json()) as AvatarUploadParams;
  const { mime, bytes } = dataURLToBytes(dataURL);
  const hash = sha256(bytes);

  const verifiedAddress = verifyTypedData(
    {
      name: "Ethereum Name Service",
      version: "1",
    },
    {
      Upload: [
        { name: "upload", type: "string" },
        { name: "expiry", type: "string" },
        { name: "name", type: "string" },
        { name: "hash", type: "string" },
      ],
    },
    {
      upload: "avatar",
      expiry,
      name,
      hash,
    },
    sig
  );
    console.log('have verified address')
  const maxSize = 1024 * 512;

  if (bytes.byteLength > maxSize) {
    return makeResponse(`Image is too large`, 413);
  }

  let owner: string;
  try {
    const nameHash = namehash(name);
    console.log(`nameHash: ${nameHash}`)
    console.log(`env.REGISTRY_ADDRESS: ${env.REGISTRY_ADDRESS}`)
    const ownerData = await handleFetch(
      env.REGISTRY_ADDRESS,
      "0x02571be3" + nameHash.substring(2)
    );
    console.log(`ownerData: ${JSON.stringify(ownerData)}`)
    const [_owner] = defaultAbiCoder.decode(["address"], ownerData.result);
    owner = _owner;
  } catch {
    console.log ('oh oh')
    return makeResponse(`${name} not found`, 404);
  }
  console.log('have owner data')

  console.log(`env.WRAPPER_ADDRESS: ${JSON.stringify(env.WRAPPER_ADDRESS)}`)
  const wrapperAddress = JSON.parse(env.WRAPPER_ADDRESS)[network];
  console.log(`owner: ${owner}`)
  console.log(`wrapperAddress: ${wrapperAddress}`)

  if (owner === wrapperAddress) {
    try {
      const nameHash = namehash(name);
      const ownerData = await handleFetch(
        wrapperAddress,
        "0x6352211e" + nameHash.substring(2)
      );
      const [_owner] = defaultAbiCoder.decode(["address"], ownerData.result);
      owner = _owner;
    } catch {
      return makeResponse(`${name} not found`, 404);
    }
  }

  if (
    verifiedAddress !== owner &&
    owner !== "0x0000000000000000000000000000000000000000"
  ) {
    return makeResponse(
      `Address ${verifiedAddress} is not the owner of ${name}`,
      403
    );
  }

  if (parseInt(expiry) < Date.now()) {
    return makeResponse(`Signature expired`, 403);
  }

  console.log(`env: ${JSON.stringify(env)}`)
  console.log(`env.AVATAR_BUCKET: ${JSON.stringify(env.AVATAR_BUCKET)}`)
  console.log(`network; ${network}`)
  console.log(`name: ${name}`)
  const bucket = env.AVATAR_BUCKET;
  const uploaded = await bucket.put(`${network}-${name}`, bytes, {
    httpMetadata: { contentType: mime },
  });
  if (uploaded.key === `${network}-${name}`) {
    return makeResponse("uploaded", 200);
  } else {
    return makeResponse(`${name} not uploaded`, 500);
  }
};
