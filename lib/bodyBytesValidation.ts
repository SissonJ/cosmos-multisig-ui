import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import {
  MsgExecuteContract,
  MsgInstantiateContract,
  MsgInstantiateContract2,
  MsgMigrateContract,
} from "cosmjs-types/cosmwasm/wasm/v1/tx";

/** TypeUrls for contract messages that contain a `msg` bytes field (standard + Secret Network) */
const contractMsgTypeUrls = new Set([
  "/cosmwasm.wasm.v1.MsgExecuteContract",
  "/cosmwasm.wasm.v1.MsgInstantiateContract",
  "/cosmwasm.wasm.v1.MsgInstantiateContract2",
  "/cosmwasm.wasm.v1.MsgMigrateContract",
  "/secret.compute.v1beta1.MsgExecuteContract",
  "/secret.compute.v1beta1.MsgInstantiateContract",
  "/secret.compute.v1beta1.MsgMigrateContract",
]);

/**
 * Decodes a contract message's value bytes using the standard CosmWasm codec.
 * This works for Secret Network messages too since the `msg` field is at the same
 * protobuf field number (3) in both schemas.
 */
const decodeMsgField = (typeUrl: string, value: Uint8Array): Uint8Array => {
  if (typeUrl.includes("MsgExecuteContract")) {
    return MsgExecuteContract.decode(value).msg;
  }
  if (typeUrl.includes("MsgInstantiateContract2")) {
    return MsgInstantiateContract2.decode(value).msg;
  }
  if (typeUrl.includes("MsgInstantiateContract")) {
    return MsgInstantiateContract.decode(value).msg;
  }
  if (typeUrl.includes("MsgMigrateContract")) {
    return MsgMigrateContract.decode(value).msg;
  }
  return new Uint8Array();
};

/**
 * Validates that bodyBytes don't contain contract messages with empty `msg` fields.
 * Returns null if valid, or an error message string if invalid.
 *
 * This catches a known issue where Keplr's Secret Network amino signing can silently
 * produce bodyBytes with an empty `msg` field when its encryption prerequisite fetches
 * (contract code hash, consensus IO public key) fail.
 */
export const validateBodyBytesMsg = (bodyBytes: Uint8Array): string | null => {
  try {
    const txBody = TxBody.decode(bodyBytes);

    for (const message of txBody.messages) {
      if (!contractMsgTypeUrls.has(message.typeUrl)) {
        continue;
      }

      const msgBytes = decodeMsgField(message.typeUrl, message.value);

      if (!msgBytes || msgBytes.length === 0) {
        return `Transaction contains a ${message.typeUrl.split(".").pop()} with an empty msg field. This usually means the wallet failed to encrypt the message (e.g. due to a network issue). Please delete and re-create the transaction.`;
      }
    }

    return null;
  } catch {
    // If we can't decode the bodyBytes, don't block — let the chain validate
    return null;
  }
};
