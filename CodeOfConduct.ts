import * as hz from 'horizon/core';

/**
 * CodeOfConduct
 * Simple script to display rules on a TextGizmo.
 * Attach this to an object with a Text Gizmo.
 */
class CodeOfConduct extends hz.Component<typeof CodeOfConduct> {
  static propsDefinition = {
    header: { type: hz.PropTypes.String, default: "CODE OF CONDUCT" },
    rule1: { type: hz.PropTypes.String, default: "1. Be Respectful to Everyone" },
    rule2: { type: hz.PropTypes.String, default: "2. No Hate Speech or Bullying" },
    rule3: { type: hz.PropTypes.String, default: "3. No Cheating or Exploiting" },
    rule4: { type: hz.PropTypes.String, default: "4. Have Fun & Play Fair!" },
    footer: { type: hz.PropTypes.String, default: "Violators will be kicked." },
    color: { type: hz.PropTypes.String, default: "#FFFFFF" }, // White text
    fontSize: { type: hz.PropTypes.Number, default: 48 },
  };

  start() {
    const textGizmo = this.entity.as(hz.TextGizmo);
    if (!textGizmo) {
        console.warn(`[CodeOfConduct] Entity ${this.entity.name.get()} must have a TextGizmo!`);
        return;
    }

    const rules = [
        this.props.header,
        "", // Spacer
        this.props.rule1,
        this.props.rule2,
        this.props.rule3,
        this.props.rule4,
        "", // Spacer
        this.props.footer
    ].join("\n");

    textGizmo.text.set(rules);
    
    // Parse hex string to Color
    const c = this.hexToColor(this.props.color);
    textGizmo.color.set(c);
  }

  private hexToColor(hex: string): hz.Color {
      // Simple hash parser (fallback to white)
      if (!hex.startsWith('#')) return new hz.Color(1, 1, 1);
      
      const r = parseInt(hex.substring(1, 3), 16) / 255;
      const g = parseInt(hex.substring(3, 5), 16) / 255;
      const b = parseInt(hex.substring(5, 7), 16) / 255;
      
      return new hz.Color(r, g, b);
  }
}

hz.Component.register(CodeOfConduct);
