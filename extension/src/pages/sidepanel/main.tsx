import { mountPage } from '../mount';
import reportCss from '../../ui/report.css?inline';
import sidepanelCss from '../../ui/sidepanel.css?inline';
import SidePanel from './SidePanel';

mountPage(<SidePanel />, `${reportCss}\n${sidepanelCss}`);
