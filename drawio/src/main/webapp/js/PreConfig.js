/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;

// Company defaults. Keep these in PreConfig so they apply before draw.io
// loads clients, resources and menus.
urlParams['lang'] = urlParams['lang'] || 'zh';
urlParams['gapi'] = urlParams['gapi'] || '0';
urlParams['db'] = urlParams['db'] || '0';
urlParams['od'] = urlParams['od'] || '0';
urlParams['gh'] = urlParams['gh'] || '0';
urlParams['gl'] = urlParams['gl'] || '0';
urlParams['tr'] = urlParams['tr'] || '0';
urlParams['picker'] = urlParams['picker'] || '0';
urlParams['plugins'] = urlParams['plugins'] || '0';
urlParams['sync'] = urlParams['sync'] || 'manual';

window.mxLanguage = window.mxLanguage || 'zh';
window.EXPORT_URL = window.EXPORT_URL || '/export';
window.PLANT_URL = window.PLANT_URL || '/plantuml';
window.DRAWIO_BASE_URL = null; // Replace with path to base of deployment, e.g. https://www.example.com/folder
window.DRAWIO_VIEWER_URL = null; // Replace your path to the viewer js, e.g. https://www.example.com/js/viewer.min.js
window.DRAWIO_LIGHTBOX_URL = null; // Replace with your lightbox URL, eg. https://www.example.com
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = window.DRAWIO_CONFIG || {
	hideMenuItems: [
		'share',
		'publishLink',
		'plugins',
		'accounts',
		'embedNotion',
		'microsoftOffice',
		'downloadDesktop'
	],
	css: [
		'.geMenubar .geButtonContainer > button.gePrimaryBtn[title^="共享"],',
		'.geMenubar .geButtonContainer > button.gePrimaryBtn[title^="Share"],',
		'.geToolbarContainer > a.geButton[title^="共享"],',
		'.geToolbarContainer > a.geButton[title^="Share"] {',
		'	display: none !important;',
		'}'
	].join('\n'),
	enableAi: false,
	enableCustomGitLabUrl: false
}; // For more details, https://www.drawio.com/doc/faq/configure-diagram-editor
