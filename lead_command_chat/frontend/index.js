import React, {useState, useMemo, useCallback} from 'react';
import {
  initializeBlock,
  useBase,
  useRecords,
  useLoadable,
  useWatchable,
  Box,
  Text,
  Heading,
  TablePickerSynced,
  Button,
  Input,
  Select,
  useGlobalConfig,
  useSession,
  expandRecord,
  Loader,
  Icon,
} from '@airtable/blocks/ui';
import { FieldType } from '@airtable/blocks/models';

// ==========================
// CONFIG — CHANGE THESE
// ==========================
const PROSPECTS_TABLE_NAME = 'Prospects';
const CONVOS_TABLE_NAME = 'Conversations';
const TEMPLATES_TABLE_NAME = 'Templates';
const NUMBERS_TABLE_NAME = 'Numbers';

// Airtable can’t call TextGrid direct, so we call YOUR proxy.
// Change this to your Render URL:
const SMS_PROXY_URL = 'https://leadcommand-chat.onrender.com'; // <- change to your endpoint

// If your Conversations table uses different field names, change here:
const CONVO_FIELDS = {
  phone: 'phone',
  to: 'to_number',
  message: 'message',
  direction: 'direction',
  ts: 'sent_at', // or 'created_at'
};

// ==========================

function LeadCommandChat() {
  const base = useBase();
  const globalConfig = useGlobalConfig();

  // tables
  const prospectsTable = base.getTableByNameIfExists(PROSPECTS_TABLE_NAME);
  const convosTable = base.getTableByNameIfExists(CONVOS_TABLE_NAME);
  const templatesTable = base.getTableByNameIfExists(TEMPLATES_TABLE_NAME);
  const numbersTable = base.getTableByNameIfExists(NUMBERS_TABLE_NAME);

  if (!prospectsTable) {
    return (
      <Box padding={3}>
        <Heading size="large">⚠️ Missing table</Heading>
        <Text>Table "{PROSPECTS_TABLE_NAME}" not found. Change the name in code.</Text>
      </Box>
    );
  }

  if (!convosTable) {
    return (
      <Box padding={3}>
        <Heading size="large">⚠️ Missing Conversations table</Heading>
        <Text>Table "{CONVOS_TABLE_NAME}" not found. Create it or adjust field names.</Text>
      </Box>
    );
  }

  // records
  const prospectRecords = useRecords(prospectsTable);
  const convoRecords = useRecords(convosTable);
  const templateRecords = templatesTable ? useRecords(templatesTable) : [];
  const numberRecords = numbersTable ? useRecords(numbersTable) : [];

  // selected prospect
  const [selectedProspectId, setSelectedProspectId] = useState(null);
  const selectedProspect = selectedProspectId
    ? prospectRecords.find(r => r.id === selectedProspectId)
    : null;

  // sender state
  const [selectedFromNumber, setSelectedFromNumber] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [messageBody, setMessageBody] = useState('');

  // ========== derived fields for selected prospect ==========
  const prospectPhone = selectedProspect
    ? normalizePhone(selectedProspect.getCellValueAsString('Phone 1 (from Linked Owner)'))
    : '';

  const prospectName = selectedProspect
    ? selectedProspect.getCellValueAsString('Name') ||
      selectedProspect.getCellValueAsString('Owner Name') ||
      'Unknown'
    : '';

  const aiScore = selectedProspect
    ? selectedProspect.getCellValue('AI Score')
    : null;

  // ========== filter conversations for this phone ==========
  const prospectConvos = useMemo(() => {
    if (!selectedProspect || !prospectPhone) return [];
    const phoneVariants = buildPhoneVariants(prospectPhone);
    return (convoRecords || [])
      .filter(rec => {
        const p = rec.getCellValueAsString(CONVO_FIELDS.phone);
        return phoneVariants.includes(normalizePhone(p));
      })
      .sort((a, b) => {
        const at = a.getCellValue(CONVO_FIELDS.ts);
        const bt = b.getCellValue(CONVO_FIELDS.ts);
        const atMs = at ? Date.parse(at) : 0;
        const btMs = bt ? Date.parse(bt) : 0;
        return atMs - btMs;
      });
  }, [selectedProspect, prospectPhone, convoRecords]);

  // ========== apply template ==========
  const handleTemplateChange = (val) => {
    setSelectedTemplateId(val);
    if (!val) return;
    const tmpl = templateRecords.find(t => t.id === val);
    if (tmpl) {
      const body = tmpl.getCellValueAsString('Body') || '';
      setMessageBody(body);
    }
  };

  // ========== send SMS through proxy ==========
  const handleSend = async () => {
    if (!prospectPhone) {
      alert('No phone for this prospect.');
      return;
    }
    if (!messageBody.trim()) {
      alert('Message is empty.');
      return;
    }

    // pick from number
    let from = selectedFromNumber;
    if (!from) {
      // try to auto-pick first number
      if (numberRecords && numberRecords.length > 0) {
        from = normalizePhone(numberRecords[0].getCellValueAsString('Number'));
        setSelectedFromNumber(from);
      } else {
        alert('No "from" number selected and no Numbers table found.');
        return;
      }
    }

    // optimistic insert into Conversations (OUT)
    try {
      await convosTable.createRecordAsync({
        [CONVO_FIELDS.phone]: prospectPhone,
        [CONVO_FIELDS.to]: from,
        [CONVO_FIELDS.message]: messageBody,
        [CONVO_FIELDS.direction]: 'OUT',
        [CONVO_FIELDS.ts]: new Date().toISOString(),
      });
    } catch (e) {
      // not fatal
      console.warn('Could not write to Conversations:', e);
    }

    // send to proxy
    try {
      const payload = {
        to: prospectPhone,
        from: from,
        body: messageBody,
        // extra context for your API
        prospect_id: selectedProspect?.id || null,
        prospect_name: prospectName,
      };
      const resp = await fetch(SMS_PROXY_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        alert('SMS proxy failed: ' + txt);
      } else {
        // success: clear message
        setMessageBody('');
      }
    } catch (err) {
      console.error(err);
      alert('SMS proxy error: ' + err.message);
    }
  };

  // ========== layout ==========
  return (
    <Box display="flex" height="100vh" backgroundColor="#0b0c10">
      {/* LEFT: prospect list */}
      <Box width="26%" borderRight="thick" borderColor="rgba(255,255,255,0.04)" padding={2} overflow="auto">
        <Heading size="small" marginBottom={2} textColor="white">🔥 Sniper Prospects</Heading>
        <Text textColor="rgba(255,255,255,0.5)" marginBottom={2}>
          Filtered by AI / motivation. Click to open convo.
        </Text>
        <ProspectList
          records={prospectRecords}
          selectedId={selectedProspectId}
          onSelect={setSelectedProspectId}
        />
      </Box>

      {/* MIDDLE: conversations */}
      <Box width="44%" display="flex" flexDirection="column" padding={3} overflow="hidden">
        {selectedProspect ? (
          <>
            <Box marginBottom={2}>
              <Heading size="small" textColor="white">{prospectName}</Heading>
              <Text textColor="rgba(255,255,255,0.5)">{prospectPhone}</Text>
              {aiScore !== null && (
                <Box marginTop={1} display="flex" alignItems="center">
                  <Box
                    backgroundColor={aiScore >= 80 ? '#00D27A' : '#FDC13A'}
                    paddingX={2}
                    paddingY={1}
                    borderRadius="pill"
                    marginRight={2}
                  >
                    <Text textColor="#0b0c10" size="small">AI Score: {aiScore}</Text>
                  </Box>
                  <Text textColor="rgba(255,255,255,0.45)" size="small">
                    {selectedProspect.getCellValueAsString('Property Address') || ''}
                  </Text>
                </Box>
              )}
            </Box>
            <Box flex="1 1 auto" overflow="auto" backgroundColor="rgba(0,0,0,0.1)" borderRadius={8} padding={2}>
              <ConversationThread conversations={prospectConvos} ourNumbers={numberRecords} />
            </Box>
          </>
        ) : (
          <Box display="flex" justifyContent="center" alignItems="center" flex="1 1 auto">
            <Text textColor="rgba(255,255,255,0.4)">Select a prospect on the left to view messages.</Text>
          </Box>
        )}
      </Box>

      {/* RIGHT: composer */}
      <Box width="30%" borderLeft="thick" borderColor="rgba(255,255,255,0.04)" padding={3} backgroundColor="rgba(0,0,0,0.25)">
        <Heading size="small" textColor="white" marginBottom={2}>✉️ Send SMS</Heading>

        {/* from number */}
        <Text textColor="rgba(255,255,255,0.5)" marginBottom={1}>From number</Text>
        <Select
          value={selectedFromNumber}
          onChange={val => setSelectedFromNumber(val)}
          options={[
            {value: '', label: 'Select...'},
            ...(numberRecords || []).map(nr => {
              const num = nr.getCellValueAsString('Number');
              const label = nr.getCellValueAsString('Label') || num;
              return {value: normalizePhone(num), label};
            }),
          ]}
          marginBottom={2}
        />

        {/* templates */}
        <Text textColor="rgba(255,255,255,0.5)" marginBottom={1}>Template</Text>
        <Select
          value={selectedTemplateId}
          onChange={handleTemplateChange}
          options={[
            {value: '', label: '— none —'},
            ...(templateRecords || []).map(tr => ({
              value: tr.id,
              label: tr.getCellValueAsString('Name') || 'Untitled template',
            })),
          ]}
          marginBottom={2}
        />

        {/* message box */}
        <Text textColor="rgba(255,255,255,0.5)" marginBottom={1}>Message</Text>
        <Input
          value={messageBody}
          onChange={e => setMessageBody(e.target.value)}
          placeholder="Type a message to seller..."
          marginBottom={2}
          style={{height: 80}}
        />

        {/* quick replies */}
        <Box marginBottom={2} display="flex" flexWrap="wrap" gridGap={6}>
          <Button
            size="small"
            onClick={() => setMessageBody("Hey! Are you still open to an offer on the property?")}
          >
            Re-engage
          </Button>
          <Button
            size="small"
            onClick={() => setMessageBody("What price would you need to make this work?")}
          >
            Asking price
          </Button>
          <Button
            size="small"
            onClick={() => setMessageBody("Okay perfect—when’s a good time to talk today?")}
          >
            Set call
          </Button>
        </Box>

        <Button
          width="100%"
          variant="primary"
          onClick={handleSend}
          disabled={!selectedProspect}
        >
          Send to {prospectPhone || '—'}
        </Button>

        <Box marginTop={3}>
          <Text textColor="rgba(255,255,255,0.3)" size="small">
            This sends via your SMS proxy ({SMS_PROXY_URL}). Update that URL in code to point to your Render/TextGrid bridge.
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function ProspectList({records, selectedId, onSelect}) {
  if (!records) return <Loader />;

  // sort by AI score desc, then by created time
  const sorted = [...records].sort((a, b) => {
    const aScore = a.getCellValue('AI Score') || 0;
    const bScore = b.getCellValue('AI Score') || 0;
    return bScore - aScore;
  });

  return (
    <Box>
      {sorted.map(rec => {
        const id = rec.id;
        const name =
          rec.getCellValueAsString('Name') ||
          rec.getCellValueAsString('Owner Name') ||
          rec.getCellValueAsString('Property Address') ||
          'Untitled';

        const phone = rec.getCellValueAsString('Phone 1 (from Linked Owner)') || '';
        const score = rec.getCellValue('AI Score') || null;
        const isSel = id === selectedId;

        return (
          <Box
            key={id}
            marginBottom={1}
            padding={2}
            borderRadius={6}
            backgroundColor={isSel ? 'rgba(0,210,122,0.18)' : 'transparent'}
            border={isSel ? 'thick' : 'default'}
            borderColor={isSel ? '#00D27A' : 'transparent'}
            onClick={() => onSelect(id)}
            style={{cursor: 'pointer'}}
          >
            <Text textColor="white" fontWeight="strong">
              {name}
            </Text>
            <Text textColor="rgba(255,255,255,0.45)" size="small">
              {phone}
            </Text>
            {score !== null && (
              <Text
                size="small"
                textColor={score >= 80 ? '#00D27A' : '#FDC13A'}
              >
                AI: {score}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ConversationThread({conversations, ourNumbers}) {
  if (!conversations || conversations.length === 0) {
    return <Text textColor="rgba(255,255,255,0.4)">No messages yet.</Text>;
  }

  // build set of our numbers for direction fallback
  const ourSet = new Set(
    (ourNumbers || []).map(nr => normalizePhone(nr.getCellValueAsString('Number')))
  );

  return (
    <Box>
      {conversations.map(rec => {
        const dir = rec.getCellValueAsString('direction') || rec.getCellValueAsString('Direction');
        const rawMsg = rec.getCellValueAsString('message') || '';
        const ts = rec.getCellValue('sent_at') || rec.getCellValue('created_at') || null;

        // fallback: if direction missing, guess by to_number
        let isOut = dir ? dir.toUpperCase() === 'OUT' : false;
        if (!dir) {
          const to = normalizePhone(rec.getCellValueAsString('to_number'));
          if (ourSet.has(to)) {
            isOut = true;
          }
        }

        return (
          <Box
            key={rec.id}
            marginBottom={2}
            display="flex"
            justifyContent={isOut ? 'flex-end' : 'flex-start'}
          >
            <Box
              maxWidth="78%"
              backgroundColor={isOut ? '#0CF3A8' : 'rgba(255,255,255,0.05)'}
              borderRadius={14}
              padding={2}
            >
              <Text textColor={isOut ? '#0b0c10' : 'white'}>{rawMsg}</Text>
              {ts && (
                <Text size="xsmall" textColor={isOut ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)'} marginTop={1}>
                  {formatTs(ts)}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// helpers
function normalizePhone(v) {
  if (!v) return '';
  return v.toString().replace(/\D/g, '');
}

function buildPhoneVariants(raw) {
  const base = normalizePhone(raw);
  const variants = new Set([base]);
  if (base.startsWith('1') && base.length === 11) {
    variants.add(base.slice(1));
  } else if (base.length === 10) {
    variants.add('1' + base);
  }
  return Array.from(variants);
}

function formatTs(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch (e) {
    return ts;
  }
}

initializeBlock(() => <LeadCommandChat />);