# 第三方组件许可声明 / Third-Party Notices

本扩展（二维码工具箱 · QR Toolkit）自身以 **MIT** 许可发布，见根目录 [`LICENSE`](LICENSE)。
扩展内打包了两份第三方开源库，其许可与版权归原作者所有，声明如下。

---

## 1. jsQR v1.4.0

| 项目 | 说明 |
| --- | --- |
| 用途 | 二维码解码（`lib/jsQR.js`） |
| 主页 | https://github.com/cozmo/jsQR |
| 版权 | Copyright (c) Cosmo Wolfe and contributors |
| 许可 | **Apache License, Version 2.0** |
| 许可全文 | [`lib/licenses/jsQR-LICENSE.txt`](lib/licenses/jsQR-LICENSE.txt) |

Apache-2.0 合规说明：

- 已随分发提供许可证全文（见上）；
- 原库不含 `NOTICE` 文件，故无额外 NOTICE 需转述；
- 上游对本项目未作任何担保或支持承诺；
- 本文件为官方发行构建 `dist/jsQR.js` 原样引入，唯一改动是在文件开头新增许可注释，未修改任何逻辑；
- 未使用上游任何商标或产品名称作为本项目品牌。

```
Copyright (c) Cosmo Wolfe and contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## 2. qrcode-generator v1.4.4

| 项目 | 说明 |
| --- | --- |
| 用途 | 二维码生成（`lib/qrcode.js`） |
| 主页 | http://www.d-project.com/ · https://github.com/kazuhikoarase/qrcode-generator |
| 版权 | Copyright (c) 2009 Kazuhiko Arase |
| 许可 | **MIT** |
| 许可全文 | [`lib/licenses/qrcode-generator-LICENSE.txt`](lib/licenses/qrcode-generator-LICENSE.txt) |

MIT 要求随分发保留版权与许可声明，原文如下：

```
MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 注：「QR Code」是 DENSO WAVE INCORPORATED 的注册商标。
