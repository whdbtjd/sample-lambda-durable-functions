/**
 * 로컬 전용: 브라우저 → 이 서버 → AWS Lambda(Durable).
 * 인터넷에 노출하지 말 것. AWS 자격 증명은 PC 기본 체인(~/.aws 등).
 *
 * 실행: AWS_REGION=ap-northeast-2 npm start
 * (또는 PowerShell: $env:AWS_REGION="ap-northeast-2"; npm start)
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LambdaClient,
  InvokeCommand,
  GetDurableExecutionHistoryCommand,
  GetDurableExecutionCommand,
  SendDurableExecutionCallbackSuccessCommand,
} from '@aws-sdk/client-lambda';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-northeast-2';
const orderProcessorFn = process.env.ORDER_PROCESSOR_FN || 'order-processor:$LATEST';
const port = Number(process.env.PORT || 3847);

const lambda = new LambdaClient({ region });

function findPaymentArn(events) {
  for (const e of events || []) {
    if (e.Name === 'process-payment' && e.ChainedInvokeStartedDetails?.DurableExecutionArn) {
      return e.ChainedInvokeStartedDetails.DurableExecutionArn;
    }
  }
  return null;
}

function findCallbackId(events) {
  for (const e of events || []) {
    if (e.EventType === 'CallbackStarted' && e.CallbackStartedDetails?.CallbackId) {
      return e.CallbackStartedDetails.CallbackId;
    }
  }
  return null;
}

async function getAllHistory(arn) {
  const events = [];
  let nextToken;
  do {
    const out = await lambda.send(
      new GetDurableExecutionHistoryCommand({
        DurableExecutionArn: arn,
        IncludeExecutionData: true,
        NextToken: nextToken,
      })
    );
    events.push(...(out.Events || []));
    nextToken = out.NextToken;
  } while (nextToken);
  return events;
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/start-order', async (req, res) => {
  try {
    const { orderId, customerId, amount } = req.body || {};
    if (!orderId || !customerId || amount === undefined || amount === '') {
      res.status(400).json({ error: 'orderId, customerId, amount 가 필요합니다.' });
      return;
    }
    const durableName = `order-${orderId}`;
    const payload = JSON.stringify({
      orderId: String(orderId),
      customerId: String(customerId),
      amount: Number(amount),
    });

    const invokeOut = await lambda.send(
      new InvokeCommand({
        FunctionName: orderProcessorFn,
        InvocationType: 'Event',
        DurableExecutionName: durableName,
        Payload: Buffer.from(payload, 'utf8'),
      })
    );

    res.json({
      durableExecutionName: durableName,
      durableExecutionArn: invokeOut.DurableExecutionArn || null,
      statusCode: invokeOut.StatusCode,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/fetch-callback', async (req, res) => {
  try {
    const { executionArn } = req.body || {};
    if (!executionArn) {
      res.status(400).json({ error: 'executionArn 이 필요합니다.' });
      return;
    }
    const orderEvents = await getAllHistory(executionArn);
    const paymentArn = findPaymentArn(orderEvents);
    if (!paymentArn) {
      res.json({
        paymentArn: null,
        callbackId: null,
        hint: '아직 process-payment 단계가 없습니다. 잠시 후 다시 시도하세요.',
      });
      return;
    }
    const paymentEvents = await getAllHistory(paymentArn);
    const callbackId = findCallbackId(paymentEvents);
    res.json({
      paymentArn,
      callbackId,
      hint: callbackId ? null : '콜백이 아직 시작되지 않았습니다. 잠시 후 다시 시도하세요.',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/approve', async (req, res) => {
  try {
    const { callbackId, approved, reason } = req.body || {};
    if (!callbackId) {
      res.status(400).json({ error: 'callbackId 가 필요합니다.' });
      return;
    }
    const resultObj =
      approved === false
        ? { approved: false, reason: reason || 'Declined' }
        : { approved: true };

    await lambda.send(
      new SendDurableExecutionCallbackSuccessCommand({
        CallbackId: callbackId,
        Result: Buffer.from(JSON.stringify(resultObj), 'utf8'),
      })
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/execution', async (req, res) => {
  try {
    const arn = req.query.arn;
    if (!arn || typeof arn !== 'string') {
      res.status(400).json({ error: 'arn 쿼리가 필요합니다.' });
      return;
    }
    const out = await lambda.send(new GetDurableExecutionCommand({ DurableExecutionArn: arn }));
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(port, () => {
  console.log(`Demo web: http://127.0.0.1:${port}  (region=${region}, fn=${orderProcessorFn})`);
});
