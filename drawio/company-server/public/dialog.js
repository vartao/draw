(function () {
  var dialogCounter = 0;
  var activeDialog = null;

  function createElement(tagName, className, text) {
    var element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (text != null) {
      element.textContent = text;
    }

    return element;
  }

  function closeActiveDialog() {
    if (activeDialog && activeDialog.close) {
      activeDialog.close(null);
    }
  }

  function focusFirst(container) {
    var target = container.querySelector('[data-autofocus]') ||
      container.querySelector('input, textarea, button, [tabindex]:not([tabindex="-1"])');

    if (target) {
      target.focus();
      if (target.select) {
        target.select();
      }
    }
  }

  function showDialog(options) {
    closeActiveDialog();

    var previousFocus = document.activeElement;
    var id = 'company-dialog-title-' + (++dialogCounter);
    var backdrop = createElement('div', 'dialog-backdrop');
    var dialog = createElement('section', 'dialog-panel');
    var closeButton = createElement('button', 'dialog-close', '×');
    var header = createElement('div', 'dialog-header');
    var kicker = createElement('div', 'dialog-kicker', options.kicker || '公司画图工具');
    var title = createElement('h2', null, options.title || '');
    var message = createElement('p', 'dialog-message', options.message || '');
    var body = createElement('div', 'dialog-body');
    var actions = createElement('div', 'dialog-actions');
    var settled = false;

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', id);
    title.id = id;
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭');

    header.appendChild(kicker);
    header.appendChild(title);
    if (options.message) {
      header.appendChild(message);
    }

    dialog.appendChild(closeButton);
    dialog.appendChild(header);

    var input = null;
    var hint = null;

    if (options.type === 'prompt') {
      var label = createElement('label', 'dialog-label', options.label || '请输入');
      input = createElement('input', 'dialog-input');
      hint = createElement('div', 'dialog-hint');
      input.type = 'text';
      input.value = options.value || '';
      input.placeholder = options.placeholder || '';
      input.autocomplete = 'off';
      input.setAttribute('data-autofocus', 'true');
      label.appendChild(input);
      body.appendChild(label);
      body.appendChild(hint);
    } else if (options.type === 'share') {
      var shareLabel = createElement('div', 'dialog-label-text', options.label || '分享链接');
      var shareRow = createElement('div', 'share-copy-row');
      input = createElement('input', 'dialog-input');
      var copyButton = createElement('button', 'copy-button', '复制');
      hint = createElement('div', 'dialog-hint');
      input.type = 'text';
      input.value = options.value || '';
      input.readOnly = true;
      input.setAttribute('data-autofocus', 'true');
      copyButton.type = 'button';
      shareRow.appendChild(input);
      shareRow.appendChild(copyButton);
      body.appendChild(shareLabel);
      body.appendChild(shareRow);
      body.appendChild(hint);

      copyButton.addEventListener('click', function () {
        var done = function () {
          hint.textContent = '已复制到剪贴板';
          hint.className = 'dialog-hint ok';
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(done).catch(function () {
            input.focus();
            input.select();
            hint.textContent = '已选中链接，请手动复制';
            hint.className = 'dialog-hint warn';
          });
        } else {
          input.focus();
          input.select();
          hint.textContent = '已选中链接，请手动复制';
          hint.className = 'dialog-hint warn';
        }
      });
    }

    if (body.childNodes.length) {
      dialog.appendChild(body);
    }

    function cleanup(result) {
      if (settled) {
        return;
      }

      settled = true;
      document.removeEventListener('keydown', handleKeydown);
      backdrop.classList.remove('is-visible');

      window.setTimeout(function () {
        if (backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }

        if (previousFocus && previousFocus.focus) {
          previousFocus.focus();
        }
      }, 160);

      activeDialog = null;
      resolver(result);
    }

    function submit() {
      if (options.type === 'confirm') {
        cleanup(true);
        return;
      }

      if (options.type === 'prompt') {
        var value = input.value.trim();

        if (options.required !== false && !value) {
          hint.textContent = options.requiredText || '请输入文件名';
          hint.className = 'dialog-hint error';
          input.focus();
          dialog.classList.remove('shake');
          window.setTimeout(function () {
            dialog.classList.add('shake');
          }, 0);
          return;
        }

        cleanup(value);
        return;
      }

      cleanup(true);
    }

    function handleKeydown(evt) {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        cleanup(options.type === 'confirm' ? false : null);
      } else if (evt.key === 'Tab') {
        var focusable = Array.prototype.slice.call(dialog.querySelectorAll('input, textarea, button, [tabindex]:not([tabindex="-1"])'))
          .filter(function (node) {
            return !node.disabled && node.offsetParent !== null;
          });

        if (!focusable.length) {
          return;
        }

        var first = focusable[0];
        var last = focusable[focusable.length - 1];

        if (evt.shiftKey && document.activeElement === first) {
          evt.preventDefault();
          last.focus();
        } else if (!evt.shiftKey && document.activeElement === last) {
          evt.preventDefault();
          first.focus();
        }
      }
    }

    closeButton.addEventListener('click', function () {
      cleanup(options.type === 'confirm' ? false : null);
    });

    backdrop.addEventListener('mousedown', function (evt) {
      if (evt.target === backdrop) {
        cleanup(options.type === 'confirm' ? false : null);
      }
    });

    var cancelButton = createElement('button', 'dialog-secondary', options.cancelText || '取消');
    var confirmButton = createElement('button', options.danger ? 'dialog-danger' : 'dialog-primary', options.confirmText || '确定');
    cancelButton.type = 'button';
    confirmButton.type = 'button';
    confirmButton.setAttribute('data-autofocus', 'true');

    if (options.type !== 'share') {
      actions.appendChild(cancelButton);
      cancelButton.addEventListener('click', function () {
        cleanup(options.type === 'confirm' ? false : null);
      });
    }

    actions.appendChild(confirmButton);
    confirmButton.addEventListener('click', submit);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);

    var resolver;
    var promise = new Promise(function (resolve) {
      resolver = resolve;
    });

    activeDialog = { close: cleanup };
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', handleKeydown);

    window.setTimeout(function () {
      backdrop.classList.add('is-visible');
      focusFirst(dialog);
    }, 0);

    if (input && options.type === 'prompt') {
      input.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          submit();
        }
      });
    }

    return promise;
  }

  window.CompanyDialog = {
    prompt: function (options) {
      return showDialog(Object.assign({ type: 'prompt' }, options || {}));
    },
    confirm: function (options) {
      return showDialog(Object.assign({ type: 'confirm' }, options || {}));
    },
    share: function (options) {
      return showDialog(Object.assign({ type: 'share' }, options || {}));
    }
  };

  window.CompanyToast = {
    show: function (options) {
      var message = typeof options === 'string' ? options : options.message;
      var tone = typeof options === 'string' ? '' : options.tone || '';
      var region = document.querySelector('.toast-region');

      if (!message) {
        return;
      }

      if (!region) {
        region = createElement('div', 'toast-region');
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('aria-atomic', 'false');
        document.body.appendChild(region);
      }

      var toast = createElement('div', 'toast' + (tone ? ' ' + tone : ''));
      var mark = createElement('span', 'toast-mark', tone === 'error' ? '!' : tone === 'warn' ? 'i' : '✓');
      var body = createElement('span', 'toast-body', message);
      var close = createElement('button', 'toast-close', '×');
      var timer = null;

      close.type = 'button';
      close.setAttribute('aria-label', '关闭提示');
      toast.appendChild(mark);
      toast.appendChild(body);
      toast.appendChild(close);
      region.appendChild(toast);

      function dismiss() {
        window.clearTimeout(timer);
        toast.classList.remove('is-visible');
        window.setTimeout(function () {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }

          if (region && !region.childNodes.length && region.parentNode) {
            region.parentNode.removeChild(region);
          }
        }, 180);
      }

      close.addEventListener('click', dismiss);

      window.setTimeout(function () {
        toast.classList.add('is-visible');
      }, 0);

      timer = window.setTimeout(dismiss, options.duration || 2800);
    }
  };
}());
