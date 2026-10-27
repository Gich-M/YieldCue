(function () {
  var key = 'yieldcue-theme'
  var root = document.documentElement

  function setTheme(theme) {
    root.setAttribute('data-theme', theme)
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      var nextTheme = theme === 'light' ? 'dark' : 'light'
      button.setAttribute('aria-label', 'Switch to ' + nextTheme + ' theme')
      button.setAttribute('title', 'Switch to ' + nextTheme + ' theme')
    })
  }

  var stored = localStorage.getItem(key)
  setTheme(stored === 'light' ? 'light' : 'dark')

  document.addEventListener('click', function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest('[data-theme-toggle]')) return
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    setTheme(next)
    localStorage.setItem(key, next)
  })
})()
