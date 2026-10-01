import React from 'react';
import Section from '../components/Section.jsx';
import { TechPresets, TechTree } from '../components/TechPicker.jsx';

export default function ResearchView({ game, techs, setTechs }) {
  return (
    <div className="view-research">
      <div className="view-head">
        <div>
          <p className="kicker">Research bureau</p>
          <h1>Research</h1>
          <p className="lede">Pick a year to start from, then adjust single technologies. Everything the designer and the equipment pages show follows this research.</p>
        </div>
      </div>
      <Section id="rs-presets" kicker="Quick start" title="Research by year">
        <TechPresets game={game} techs={techs} setTechs={setTechs} />
      </Section>
      <Section id="rs-tree" kicker="Technology" title="Tech tree" className="flush">
        <TechTree game={game} techs={techs} setTechs={setTechs} inline />
      </Section>
    </div>
  );
}
