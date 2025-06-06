import { MsgExecuteContractEncodeObject } from "@cosmjs/cosmwasm-stargate";
import { toUtf8 } from "@cosmjs/encoding";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { MsgGetter } from "..";
import { useChains } from "../../../../context/ChainsContext";
import { ChainInfo } from "../../../../context/ChainsContext/types";
import { displayCoinToBaseCoin } from "../../../../lib/coinHelpers";
import { checkAddress, exampleAddress, trimStringsObj } from "../../../../lib/displayHelpers";
import { MsgCodecs, MsgTypeUrls } from "../../../../types/txMsg";
import Input from "../../../inputs/Input";
import Select from "../../../inputs/Select";
import StackableContainer from "../../../layout/StackableContainer";
import { EncryptionUtilsImpl, MsgExecuteContract, SecretNetworkClient } from "secretjs";

const JsonEditor = dynamic(() => import("../../../inputs/JsonEditor"), { ssr: false });

const customDenomOption = { label: "Custom (enter denom below)", value: "custom" } as const;

const getDenomOptions = (assets: ChainInfo["assets"]) => {
  if (!assets?.length) {
    return [customDenomOption];
  }

  return [...assets.map((asset) => ({ label: asset.symbol, value: asset })), customDenomOption];
};

interface MsgExecuteContractFormProps {
  readonly senderAddress: string;
  readonly setMsgGetter: (msgGetter: MsgGetter) => void;
  readonly deleteMsg: () => void;
}

const MsgExecuteContractForm = ({
  senderAddress,
  setMsgGetter,
  deleteMsg,
}: MsgExecuteContractFormProps) => {
  const { chain } = useChains();

  const denomOptions = getDenomOptions(chain.assets);

  const [contractAddress, setContractAddress] = useState("");
  // SCRT Network specific
  const [codeHash, setCodeHash] = useState("");
  const [lcd, setLcd] = useState("");

  const [msgContent, setMsgContent] = useState("{}");
  const [selectedDenom, setSelectedDenom] = useState(denomOptions[0]);
  const [customDenom, setCustomDenom] = useState("");
  const [amount, setAmount] = useState("0");

  const jsonError = useRef(false);
  const [contractAddressError, setContractAddressError] = useState("");
  // SCRT Network specific
  const [codeHashError, setCodeHashError] = useState("");
  const [lcdError, setLcdError] = useState("");

  const [customDenomError, setCustomDenomError] = useState("");
  const [amountError, setAmountError] = useState("");

  const trimmedInputs = trimStringsObj({ contractAddress, codeHash, lcd, customDenom, amount });

  const generateCodeHash = async () => {
    if (!lcd || !contractAddress) {
      setLcdError("LCD URL and Contract Address are required");
      return;
    }

console.log(lcd, chain.chainId, contractAddress);
    try {
      const client = new SecretNetworkClient({
        url: lcd,
        chainId: chain.chainId,
      });

      const result = await client.query.compute.codeHashByContractAddress({ contract_address: contractAddress });
      if (result?.code_hash) {
        setCodeHash(result.code_hash);
        setCodeHashError("");
      } else {
        setCodeHashError("Could not retrieve code hash");
      }
    } catch (error) {
      console.error('Failed to generate code hash:', error);
      setCodeHashError(`Failed to generate code hash: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line no-shadow
    const { contractAddress, codeHash, lcd, customDenom, amount } = trimmedInputs;
    const denom =
      selectedDenom.value === customDenomOption.value ? customDenom : selectedDenom.value.symbol;

    const isMsgValid = (): boolean => {
      setContractAddressError("");
      setCustomDenomError("");
      setAmountError("");

      if (jsonError.current) {
        return false;
      }

      const addressErrorMsg = checkAddress(contractAddress, chain.addressPrefix);
      if (addressErrorMsg) {
        setContractAddressError(`Invalid address for network ${chain.chainId}: ${addressErrorMsg}`);
        return false;
      }

      if (
        selectedDenom.value === customDenomOption.value &&
        !customDenom &&
        amount &&
        amount !== "0"
      ) {
        setCustomDenomError("Custom denom must be set because of selection above");
        return false;
      }

      if (amount && Number(amount) < 0) {
        setAmountError("Amount must be empty or a positive number");
        return false;
      }

      if (selectedDenom.value === customDenomOption.value && !Number.isInteger(Number(amount))) {
        setAmountError("Amount cannot be decimal for custom denom");
        return false;
      }

      if (denom && amount) {
        try {
          displayCoinToBaseCoin({ denom, amount }, chain.assets);
        } catch (e: unknown) {
          setAmountError(e instanceof Error ? e.message : "Could not set decimals");
          return false;
        }
      }

      return true;
    };

    const microCoin = (() => {
      try {
        if (!denom || !amount || amount === "0") {
          return null;
        }

        return displayCoinToBaseCoin({ denom, amount }, chain.assets);
      } catch {
        return null;
      }
    })();

    const msgContentUtf8Array = (() => {
      try {
        // The JsonEditor does not escape \n or remove whitespaces, so we need to parse + stringify
        return toUtf8(JSON.stringify(JSON.parse(msgContent)));
      } catch {
        return undefined;
      }
    })();

    const msgContentJSON = (() => {
      try {
        // The JsonEditor does not escape \n or remove whitespaces, so we need to parse + stringify
        return JSON.parse(msgContent);
      } catch {
        return undefined;
      }
    })();

    let msgValue = MsgCodecs[MsgTypeUrls.ExecuteContract].fromPartial({
      sender: senderAddress,
      contract: contractAddress,
      msg: msgContentUtf8Array,
      funds: microCoin ? [microCoin] : [],
    });

    if (chain.denom === "uscrt") {
      if(codeHash === '') {
        setCodeHashError("Code hash is required for Secret Network");
        return;
      }
      if(lcd === '') {
        setLcdError("LCD is required for Secret Network Execute Message");
        return;
      }
      const executeMsg = new MsgExecuteContract({
        code_hash: codeHash,
        contract_address: msgValue.contract,
        sender: msgValue.sender,
        sent_funds: msgValue.funds,
        msg: msgContentJSON,
      });
      const encryptionUtils = new EncryptionUtilsImpl(
         lcd,
         new Uint8Array(32),
         chain.chainId,
      )
      // This encrypts the msg for execution on the Secret Network blockchain
      executeMsg.toAmino(encryptionUtils).then((amino) => {
        // @ts-expect-error secret needs the same encrypted msg to be signed everywhere
        msgValue.encryptedMsg = amino.value.msg;
      });
      msgValue = {
        ...msgValue,
      };
    }

    const msg: MsgExecuteContractEncodeObject = {
      typeUrl: MsgTypeUrls.ExecuteContract,
      value: msgValue,
    };

    setMsgGetter({ isMsgValid, msg });
  }, [
    chain.addressPrefix,
    chain.assets,
    chain.chainId,
    chain.denom,
    msgContent,
    selectedDenom.value,
    senderAddress,
    setMsgGetter,
    trimmedInputs,
  ]);

  return (
    <StackableContainer lessPadding lessMargin>
      <button className="remove" onClick={() => deleteMsg()}>
        ✕
      </button>
      <h2>MsgExecuteContract</h2>
      <div className="form-item">
        <Input
          label="Contract Address"
          name="contract-address"
          value={contractAddress}
          onChange={({ target }) => {
            setContractAddress(target.value);
            setContractAddressError("");
          }}
          error={contractAddressError}
          placeholder={`E.g. ${exampleAddress(0, chain.addressPrefix)}`}
        />
      </div>
      {chain.denom === "uscrt" && (
        <div className="form-item">
          <Input
            label="LCD Node"
            name="lcd"
            value={lcd}
            onChange={({ target }) => {
              setLcd(target.value);
              setLcdError("");
            }}
            error={lcdError}
            placeholder={``}
          />
        </div>
      )}
      {chain.denom === "uscrt" && lcd !== '' && (
        <button className="generate" onClick={() => generateCodeHash()}>
          Generate Code Hash
        </button>
      )}
      {chain.denom === "uscrt" && (
        <div className="form-item">
          <Input
            label="Code Hash"
            name="code-hash"
            value={codeHash}
            onChange={({ target }) => {
              setCodeHash(target.value);
              setCodeHashError("");
            }}
            error={codeHashError}
            placeholder={``}
          />
        </div>
      )}
      <div className="form-item">
        <JsonEditor
          label="Msg JSON"
          content={{ text: msgContent }}
          onChange={(newMsgContent, _, { contentErrors }) => {
            setMsgContent("text" in newMsgContent ? (newMsgContent.text ?? "{}") : "{}");
            jsonError.current = !!contentErrors;
          }}
        />
      </div>
      <div className="form-item form-select">
        <label>Choose a denom:</label>
        <Select
          label="Select denom"
          name="denom-select"
          options={denomOptions}
          value={selectedDenom}
          onChange={(option: (typeof denomOptions)[number]) => {
            setSelectedDenom(option);
            if (option.value !== customDenomOption.value) {
              setCustomDenom("");
            }
            setCustomDenomError("");
          }}
        />
      </div>
      {selectedDenom.value === customDenomOption.value ? (
        <div className="form-item">
          <Input
            label="Custom denom"
            name="custom-denom"
            value={customDenom}
            onChange={({ target }) => {
              setCustomDenom(target.value);
              setCustomDenomError("");
            }}
            placeholder={
              selectedDenom.value === customDenomOption.value
                ? "Enter custom denom"
                : "Select Custom denom above"
            }
            disabled={selectedDenom.value !== customDenomOption.value}
            error={customDenomError}
          />
        </div>
      ) : null}
      <div className="form-item">
        <Input
          type="number"
          label="Amount"
          name="amount"
          value={amount}
          onChange={({ target }) => {
            setAmount(target.value);
            setAmountError("");
          }}
          error={amountError}
        />
      </div>
      <style jsx>{`
        .form-item {
          margin-top: 1.5em;
        }
        .form-item label {
          font-style: italic;
          font-size: 12px;
        }
        .form-select {
          display: flex;
          flex-direction: column;
          gap: 0.8em;
        }
        button.remove {
          background: rgba(255, 255, 255, 0.2);
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: none;
          color: white;
          position: absolute;
          right: 10px;
          top: 10px;
        }
        button.generate {
          margin-top: 20px;
          background: rgba(255, 255, 255, 0.2);
          height: 30px;
          border-radius: 10px;
          border: none;
          color: white;
        }
      `}</style>
    </StackableContainer>
  );
};

export default MsgExecuteContractForm;
