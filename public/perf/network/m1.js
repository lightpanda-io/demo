import { two } from './m2.js?delay=40';
import { three } from './m3.js?delay=40';
(window.__ran ||= []).push('m1', two, three);
