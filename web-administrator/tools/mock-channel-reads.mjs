// Save-model unit tests supply deliberate draft/legacy shapes (including empty
// arrays and string flags), not serialized engine XML. Mock at the same API
// boundary as channel-save-tags.test.js while retaining the real HTTP error,
// session-fence and template-decoding behavior. The browser channel-xml-read
// suite covers the production XML transport and exact request counts.
import api from '../client/core/api.js';
import { decodeChannelTemplates } from '../client/core/oie.js';

api.channels.get = id => api.get(`/channels/${encodeURIComponent(id)}`).then(decodeChannelTemplates);
