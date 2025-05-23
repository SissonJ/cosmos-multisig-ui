import { loadValidators } from "@/context/ChainsContext/helpers";
import { DbTransactionParsedDataJson } from "@/graphql";
import { createDbTx } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/utils";
import { MsgTypeUrl, MsgTypeUrls } from "@/types/txMsg";
import { EncodeObject } from "@cosmjs/proto-signing";
import { Account, calculateFee } from "@cosmjs/stargate";
import { assert, sleep } from "@cosmjs/utils";
import { NextRouter, withRouter } from "next/router";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useChains } from "../../../context/ChainsContext";
import { exportMsgToJson, gasOfTx } from "../../../lib/txMsgHelpers";
import Button from "../../inputs/Button";
import Input from "../../inputs/Input";
import StackableContainer from "../../layout/StackableContainer";
import MsgForm from "./MsgForm";

export interface MsgGetter {
  readonly isMsgValid: () => boolean;
  readonly msg: EncodeObject;
}

interface OldCreateTxFormProps {
  readonly router: NextRouter;
  readonly senderAddress: string;
  readonly accountOnChain: Account;
}

const OldCreateTxForm = ({ router, senderAddress, accountOnChain }: OldCreateTxFormProps) => {
  const {
    chain,
    validatorState: { validators },
    chainsDispatch,
  } = useChains();

  const [processing, setProcessing] = useState(false);
  const [msgTypes, setMsgTypes] = useState<readonly MsgTypeUrl[]>([]);
  const [msgKeys, setMsgKeys] = useState<readonly string[]>([]);
  const msgGetters = useRef<MsgGetter[]>([]);
  const [memo, setMemo] = useState("");
  const [gasLimit, setGasLimit] = useState(gasOfTx([]));
  const [gasLimitError, setGasLimitError] = useState("");

  const addMsgType = (newMsgType: MsgTypeUrl) => {
    setMsgKeys((oldMsgKeys) => [...oldMsgKeys, crypto.randomUUID()]);
    setMsgTypes((oldMsgTypes) => {
      const newMsgTypes = [...oldMsgTypes, newMsgType];
      setGasLimit(gasOfTx(newMsgTypes));
      return newMsgTypes;
    });
  };

  const addMsgWithValidator = (newMsgType: MsgTypeUrl) => {
    const validatorsLoaded = !!validators.bonded.length;
    if (!validatorsLoaded) {
      loadValidators(chainsDispatch);
    }

    addMsgType(newMsgType);
  };

  const createTx = async () => {
    const loadingToastId = toast.loading("Creating transaction");
    setProcessing(true);
    // If it fails too fast, toast.dismiss does not work
    await sleep(500);

    try {
      assert(typeof accountOnChain.accountNumber === "number", "accountNumber missing");
      assert(msgGetters.current.length, "form filled incorrectly");

      const msgs = msgGetters.current
        .filter(({ isMsgValid }) => isMsgValid())
        .map(({ msg }) => chain.denom === 'uscrt'
          ? { // Persist code hash and other metadata for SecretNetwork
             typeUrl: exportMsgToJson(msg).typeUrl,
             value: {
               encryptedMsg: msg.value.encryptedMsg,
               ...exportMsgToJson(msg).value,
             }
           } : exportMsgToJson(msg));

      if (!msgs.length || msgs.length !== msgTypes.length) {
        return;
      }

      if (!Number.isSafeInteger(gasLimit) || gasLimit <= 0) {
        setGasLimitError("gas limit must be a positive integer");
        return;
      }

      const txData: DbTransactionParsedDataJson = {
        accountNumber: accountOnChain.accountNumber,
        sequence: accountOnChain.sequence,
        chainId: chain.chainId,
        msgs,
        fee: calculateFee(gasLimit, chain.gasPrice),
        memo,
      };

      const txId = await createDbTx(accountOnChain.address, chain.chainId, txData);
      toastSuccess("Transaction created with ID", txId);
      router.push(`/${chain.registryName}/${senderAddress}/transaction/${txId}`);
    } catch (e) {
      console.error("Failed to create transaction:", e);
      toastError({
        description: "Failed to create transaction",
        fullError: e instanceof Error ? e : undefined,
      });
      setProcessing(false);
    } finally {
      toast.dismiss(loadingToastId);
    }
  };

  return (
    <StackableContainer
      lessPadding
      divProps={{ style: { width: "min(690px, 90vw)", maxWidth: "690px" } }}
    >
      <h2>Create New Transaction</h2>
      {msgTypes.length ? (
        msgTypes.map((msgType, index) => (
          <MsgForm
            key={msgKeys[index]}
            msgType={msgType}
            senderAddress={senderAddress}
            setMsgGetter={(msgGetter) => {
              msgGetters.current = [
                ...msgGetters.current.slice(0, index),
                msgGetter,
                ...msgGetters.current.slice(index + 1),
              ];
            }}
            deleteMsg={() => {
              msgGetters.current.splice(index, 1);
              setMsgKeys((oldMsgKeys) => [
                ...oldMsgKeys.slice(0, index),
                ...oldMsgKeys.slice(index + 1),
              ]);
              setMsgTypes((oldMsgTypes) => {
                const newMsgTypes: MsgTypeUrl[] = oldMsgTypes.slice();
                newMsgTypes.splice(index, 1);
                setGasLimit(gasOfTx(newMsgTypes));
                return newMsgTypes;
              });
            }}
          />
        ))
      ) : (
        <StackableContainer lessMargin lessPadding>
          <p className="empty-msg-warning">Add at least one message to this transaction</p>
        </StackableContainer>
      )}
      <div className="form-item">
        <Input
          type="number"
          label="Gas Limit"
          name="gas-limit"
          value={gasLimit}
          onChange={({ target }) => setGasLimit(Number(target.value))}
        />
      </div>
      <div className="form-item">
        <Input
          label="Gas Price"
          name="gas-price"
          value={chain.gasPrice}
          disabled={true}
          error={gasLimitError}
        />
      </div>
      <div className="form-item">
        <Input
          label="Memo"
          name="memo"
          value={memo}
          onChange={({ target }) => setMemo(target.value)}
        />
      </div>
      <h4 className="mx-0 my-5 block font-bold">Add New Msg</h4>
      <div className="btn-cluster-grid">
        <div className="btn-cluster">
          <label>Bank</label>
          <ul>
            <li>
              <Button label="Send" onClick={() => addMsgType(MsgTypeUrls.Send)} />
            </li>
          </ul>
        </div>
        <div className="btn-cluster">
          <label>Governance</label>
          <ul>
            <li>
              <Button label="Vote" onClick={() => addMsgType(MsgTypeUrls.Vote)} />
            </li>
          </ul>
        </div>
        <div className="btn-cluster">
          <label>IBC</label>
          <ul>
            <li>
              <Button label="Transfer" onClick={() => addMsgType(MsgTypeUrls.Transfer)} />
            </li>
          </ul>
        </div>
        <div className="btn-cluster">
          <label>Vesting</label>
          <ul>
            <li>
              <Button
                label="CreateVestingAccount"
                onClick={() => addMsgType(MsgTypeUrls.CreateVestingAccount)}
              />
            </li>
          </ul>
        </div>
        <div className="btn-cluster">
          <label>Staking</label>
          <ul>
            <li>
              <Button label="Delegate" onClick={() => addMsgWithValidator(MsgTypeUrls.Delegate)} />
            </li>
            <li>
              <Button
                label="Undelegate"
                onClick={() => addMsgWithValidator(MsgTypeUrls.Undelegate)}
              />
            </li>
            <li>
              <Button
                label="BeginRedelegate"
                onClick={() => addMsgWithValidator(MsgTypeUrls.BeginRedelegate)}
              />
            </li>
          </ul>
        </div>
        <div className="btn-cluster">
          <label>Distribution</label>
          <ul>
            <li>
              <Button
                label="FundCommunityPool"
                onClick={() => addMsgType(MsgTypeUrls.FundCommunityPool)}
              />
            </li>
            <li>
              <Button
                label="SetWithdrawAddress"
                onClick={() => addMsgType(MsgTypeUrls.SetWithdrawAddress)}
              />
            </li>
            <li>
              <Button
                label="WithdrawDelegatorReward"
                onClick={() => addMsgWithValidator(MsgTypeUrls.WithdrawDelegatorReward)}
              />
            </li>
          </ul>
        </div>
        <div className="btn-cluster">
          <label>CosmWasm</label>
          <ul>
            <li>
              <Button
                label="InstantiateContract"
                onClick={() => addMsgType(MsgTypeUrls.InstantiateContract)}
              />
            </li>
            <li>
              <Button
                label="InstantiateContract2"
                onClick={() => addMsgType(MsgTypeUrls.InstantiateContract2)}
              />
            </li>
            <li>
              <Button
                label="ExecuteContract"
                onClick={() => addMsgType(MsgTypeUrls.ExecuteContract)}
              />
            </li>
            <li>
              <Button
                label="MigrateContract"
                onClick={() => addMsgType(MsgTypeUrls.MigrateContract)}
              />
            </li>
            <li>
              <Button
                label="UpdateAdminContract"
                onClick={() => addMsgType(MsgTypeUrls.UpdateAdmin)}
              />
            </li>
          </ul>
        </div>
      </div>
      <Button
        label="Create Transaction"
        onClick={createTx}
        disabled={!msgTypes.length}
        loading={processing}
      />
      <style jsx>{`
        p {
          margin-top: 15px;
        }
        .empty-msg-warning {
          margin: 0;
          font-size: 16px;
        }
        .form-item {
          margin-top: 1.5em;
        }
        .multisig-error {
          margin: 0;
          max-width: 100%;
          color: red;
          font-size: 16px;
          text-align: center;
        }
        .btn-cluster-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          justify-content: flex-start;
          align-items: center;
        }
        .btn-cluster {
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .btn-cluster label {
          text-decoration: underline;
        }
        .btn-cluster ul {
          list-style: none;
          margin: 0;
          padding: 0;

          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          justify-content: flex-start;
          align-items: center;
        }
      `}</style>
    </StackableContainer>
  );
};

export default withRouter(OldCreateTxForm);
